import { createHash } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db, type DbTx } from "../db";
import { agents, printers, printJobs, printJobReceipts, discoveredDevices, discoverySessions } from "../db/schema";
import { idempotencyDigest } from "./print-job-service";
import { isTerminal, type JobStatus } from "./job-status";
import { RECEIPT_MATERIALIZE_BATCH_ROWS } from "../shared/job-retention";
import { requirePlatformActorInTransaction, type PlatformOwnerClaims } from "./platform-auth";
import { writeAuditEvent } from "./audit";

type DeletionResult = { status: number; ok?: true; error?: string; id?: string; tenantId?: string; kind?: "agents" | "printers" };
type Kind = "agents" | "printers";

/** Acknowledged operations are never simply dropped when removing inventory.
 * These receipts survive job retention/credential deletion, with payload erased.
 * An in-flight hardware attempt has UNKNOWN outcome, never a retryable promise.
 */
async function archiveJobs(
  tx: DbTx, tenantId: string, where: ReturnType<typeof and>, reason: string,
): Promise<number> {
  let archived = 0;
  for (;;) {
    const ids = await tx.select({ id: printJobs.id }).from(printJobs).where(where).limit(100).for("update");
    if (!ids.length) break;
    for (let offset = 0; offset < ids.length; offset += RECEIPT_MATERIALIZE_BATCH_ROWS) {
      const batch = ids.slice(offset, offset + RECEIPT_MATERIALIZE_BATCH_ROWS).map(item => item.id);
      const jobs = await tx.select().from(printJobs)
        .where(and(eq(printJobs.tenantId, tenantId), inArray(printJobs.id, batch))).for("update");
      for (const job of jobs) {
        const terminal = isTerminal(job.status as JobStatus);
        const uncertain = job.status === "printing" || job.error === "DELIVERY_EVIDENCE_PENDING" ||
          !!job.deliveredAt || !!job.ackedAt || !!job.spoolerJobId || !!job.attemptId;
        await tx.insert(printJobReceipts).values({
          id: job.id, tenantId: job.tenantId, idempotencyKey: job.idempotencyKey,
          fingerprint: idempotencyDigest({ printerId: job.printerId, documentType: job.documentType, destination: job.destination, payload: job.payload }),
          printerId: job.printerId, agentId: job.agentId, apiKeyId: job.apiKeyId,
          destination: job.destination, documentType: job.documentType, requestedBy: job.requestedBy,
          status: terminal ? job.status : "failed",
          error: terminal ? job.error : uncertain
            ? "UNKNOWN_PARTIAL_DELIVERY: Device removed while a hardware attempt may have started; inspect the printer before reprinting."
            : reason,
          closedClaimTokenHash: job.closedClaimTokenHash ?? (job.claimToken ? createHash("sha256").update(job.claimToken).digest("hex") : null),
          deliveredAt: job.deliveredAt, ackedAt: job.ackedAt, createdAt: job.createdAt,
          updatedAt: terminal ? job.updatedAt : sql`clock_timestamp()`,
        });
      }
      await tx.delete(printJobs).where(and(eq(printJobs.tenantId, tenantId), inArray(printJobs.id, batch)));
      archived += jobs.length;
    }
  }
  return archived;
}

/** Platform-only, tenant/Agent-fenced deletion. Printer deletion is a durable
 * negative tombstone: a local Agent must not rediscover/resurrect it on heartbeat.
 * Agent deletion removes the row + all attached printers and credentials.
 */
export async function removeFleetItem(input: {
  kind: Kind; tenantId: string; id: string; expectedLifecycle: string; reason: string;
  actor: PlatformOwnerClaims;
}): Promise<DeletionResult> {
  const { kind, tenantId, id, reason, actor, expectedLifecycle } = input;
  return db.transaction(async tx => {
    // All printer admissions and Agent heartbeat snapshots acquire this first.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('printers:' || ${tenantId}))`);
    // The same admission barrier as print-job enqueue and key deletion.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`print_jobs:tenant:${tenantId}`}))`);
    if (kind === "agents") await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`print_jobs:agent:${id}`}))`);

    if (kind === "agents") {
      const locked = await tx.execute(sql`SELECT id, lifecycle FROM agents WHERE tenant_id = ${tenantId} AND id = ${id} FOR UPDATE`);
      const row = locked.rows[0] as { id: string; lifecycle: string } | undefined;
      if (!row) return { status: 404, error: "Agent not found" };
      if (row.lifecycle !== expectedLifecycle) return { status: 409, error: "Agent state changed; refresh" };
      await requirePlatformActorInTransaction(tx, actor);
      const ownedPrinters = await tx.select({ id: printers.id }).from(printers)
        .where(and(eq(printers.tenantId, tenantId), eq(printers.agentId, id))).for("update");
      const printerIds = ownedPrinters.map(p => p.id);
      const where = and(eq(printJobs.tenantId, tenantId),
        or(eq(printJobs.agentId, id), ...(printerIds.length ? [inArray(printJobs.printerId, printerIds)] : [])));
      const archivedJobs = await archiveJobs(tx, tenantId, where,
        "AGENT_DELETED: Cancelled before delivery by platform owner.");
      await tx.delete(discoveredDevices).where(and(eq(discoveredDevices.tenantId, tenantId), eq(discoveredDevices.agentId, id)));
      await tx.delete(discoverySessions).where(and(eq(discoverySessions.tenantId, tenantId), eq(discoverySessions.agentId, id)));
      await tx.delete(printers).where(and(eq(printers.tenantId, tenantId), eq(printers.agentId, id)));
      await tx.delete(agents).where(and(eq(agents.tenantId, tenantId), eq(agents.id, id)));
      await writeAuditEvent({ tenantId, actorType: "platform", actorId: actor.userId,
        action: "agent.deleted", resourceType: "agent", resourceId: id,
        metadata: { reason, archivedJobs, printerIds } }, tx);
      await tx.execute(sql`SELECT pg_notify('print_gateway_agent_sessions', ${JSON.stringify({ agentId: id })}::text)`);
      return { status: 200, ok: true, kind, id, tenantId };
    }

    const owner = await tx.select({ agentId: printers.agentId }).from(printers)
      .where(and(eq(printers.id, id), eq(printers.tenantId, tenantId))).limit(1);
    if (!owner[0]) return { status: 404, error: "Printer not found" };
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`print_jobs:agent:${owner[0].agentId}`}))`);
    const agentLock = await tx.execute(sql`SELECT id FROM agents WHERE tenant_id = ${tenantId} AND id = ${owner[0].agentId} FOR UPDATE`);
    if (!agentLock.rows[0]) return { status: 409, error: "Printer owner changed" };
    const locked = await tx.select().from(printers)
      .where(and(eq(printers.tenantId, tenantId), eq(printers.id, id), eq(printers.agentId, owner[0].agentId))).for("update");
    const printer = locked[0];
    if (!printer) return { status: 409, error: "Printer owner changed" };
    if (printer.lifecycle !== expectedLifecycle || printer.lifecycle === "retired")
      return { status: 409, error: "Printer is already removed or its state changed" };
    // Even a locally unshared printer remains under platform administrative
    // jurisdiction; retiring it does not grant any new execution permission.
    await requirePlatformActorInTransaction(tx, actor);
    const archivedJobs = await archiveJobs(tx, tenantId,
      and(eq(printJobs.tenantId, tenantId), eq(printJobs.printerId, id)),
      "PRINTER_REMOVED: Cancelled before delivery by platform owner.");
    // Do NOT erase the row: a negative persistent tombstone is required to
    // prevent the still-running Agent from automatically re-provisioning it.
    await tx.update(printers).set({
      lifecycle: "retired", sharedWithGateway: false,
      managementSource: "manager", inventoryPresent: false, status: "unknown",
      desiredRevision: sql<number>`${printers.desiredRevision} + 1`,
      updatedAt: sql`clock_timestamp()`,
    }).where(and(eq(printers.tenantId, tenantId), eq(printers.id, id)));
    await writeAuditEvent({ tenantId, actorType: "platform", actorId: actor.userId,
      action: "printer.removed", resourceType: "printer", resourceId: id,
      metadata: { reason, archivedJobs, tombstoneRetained: true, agentId: owner[0].agentId } }, tx);
    return { status: 200, ok: true, kind, id, tenantId };
  });
}
