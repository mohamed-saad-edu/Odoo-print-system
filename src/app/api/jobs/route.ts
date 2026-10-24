import { requireActiveTenantInTransaction, TenantDeletedError, TenantSuspendedError } from "../../../lib/tenant-guard";
import { requireManagerActorInTransaction, ManagerMutationAuthorityChangedError } from "../../../lib/manager-mutation-authorization";
import { NextResponse } from "next/server";
import { db } from "../../../db";
import { idempotencyDigest } from "../../../lib/print-job-service";
import { printJobs, printJobReceipts } from "../../../db/schema";
import { validateWorkspaceManager } from "../../../lib/manager-auth";
import { validateConsoleAuth } from "../../../lib/console-auth";
import { requireManagerPermission } from "../../../lib/authorization";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { clampListLimit } from "../../../lib/request-limits";
import { RECEIPT_MATERIALIZE_BATCH_ROWS } from "../../../shared/job-retention";
import { isJobFilterStatus } from "../../../lib/job-status";
import { databaseNowMs } from "../../../lib/database-clock";
import { listPrintJobHistory } from "../../../lib/job-history";

export const dynamic = "force-dynamic";

const TERMINAL_JOB_STATUSES = ["success", "failed", "expired"] as const;
const MAX_CLEANUP_ROWS = 5000;
const MAX_LIST_OFFSET = 10_000;
const MAX_SEARCH_LENGTH = 64;
const MAX_FILTER_ID_LENGTH = 2048;

export async function GET(req: Request) {
  const auth = await validateConsoleAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenantId = auth.kind === "manager" ? auth.claims.tenantId : auth.agent.tenantId;
  if (auth.kind === "manager") {
    try { requireManagerPermission(auth.claims, "jobs.read"); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }
  }

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status")?.trim().toLowerCase();
  const searchParam = (url.searchParams.get("search") ?? url.searchParams.get("q"))?.trim();
  const printerId = url.searchParams.get("printerId")?.trim() || null;
  const agentId = url.searchParams.get("agentId")?.trim() || null;
  const limit = clampListLimit(url.searchParams.get("limit"), 50, 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
  if (offset > MAX_LIST_OFFSET) {
    return NextResponse.json({ error: `offset must be <= ${MAX_LIST_OFFSET}` }, { status: 400 });
  }
  if (searchParam && (searchParam.length < 2 || searchParam.length > MAX_SEARCH_LENGTH)) {
    return NextResponse.json({ error: `search must be between 2 and ${MAX_SEARCH_LENGTH} characters` }, { status: 400 });
  }
  if ((printerId && printerId.length > MAX_FILTER_ID_LENGTH) || (agentId && agentId.length > MAX_FILTER_ID_LENGTH)) {
    return NextResponse.json({ error: `printerId and agentId must be <= ${MAX_FILTER_ID_LENGTH} characters` }, { status: 400 });
  }

  if (statusParam && !isJobFilterStatus(statusParam)) {
    return NextResponse.json({ error: "invalid status filter" }, { status: 400 });
  }

  const rows = await listPrintJobHistory({
    tenantId,
    agentId: auth.kind === "agent" ? auth.agent.id : agentId ?? undefined,
    printerId: printerId ?? undefined,
    status: statusParam,
    search: searchParam,
    limit,
    offset,
  });
  return NextResponse.json(rows, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function DELETE(req: Request) {
  const claims = await validateWorkspaceManager(req);
  if (!claims) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { requireManagerPermission(claims, "jobs.cancel"); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

  const url = new URL(req.url);
  const beforeRaw = url.searchParams.get("before");
  const limitRaw = url.searchParams.get("limit");
  const confirm = url.searchParams.get("confirm");
  if (confirm !== "1") return NextResponse.json({ error: "Cleanup requires confirm=1" }, { status: 400 });
  if (!beforeRaw) return NextResponse.json({ error: "Cleanup requires before=<ISO-8601 timestamp>" }, { status: 400 });

  const before = new Date(beforeRaw);
  if (Number.isNaN(before.getTime())) return NextResponse.json({ error: "before must be a valid ISO-8601 timestamp" }, { status: 400 });
  const databaseNow = await databaseNowMs();
  if (before.getTime() > databaseNow) return NextResponse.json({ error: "before cannot be in the future" }, { status: 400 });

  const requestedLimit = limitRaw === null ? MAX_CLEANUP_ROWS : Number(limitRaw);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_CLEANUP_ROWS) {
    return NextResponse.json({ error: `limit must be an integer between 1 and ${MAX_CLEANUP_ROWS}` }, { status: 400 });
  }

  let deleted: number;
  try { deleted = await db.transaction(async (tx) => {
    await requireActiveTenantInTransaction(tx, claims.tenantId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`print_jobs:tenant:${claims.tenantId}`}))`);
    // IDs first: materializing up to 5000 full rows (payloads up to 5 MiB)
    // would exhaust Gateway memory. Full rows are fetched in small inner
    // batches below, so peak memory stays bounded by RECEIPT_MATERIALIZE_BATCH_ROWS.
    const candidateIds = await tx.select({ id: printJobs.id }).from(printJobs).where(
      and(
        eq(printJobs.tenantId, claims.tenantId),
        inArray(printJobs.status, [...TERMINAL_JOB_STATUSES]),
        // Match the automatic retention boundary: only a terminal row whose
        // execution fence has been fully released can be removed. Ambiguous
        // outcomes keep claim_token until their bounded reconciliation window
        // closes, then the payload-free receipt preserves their final evidence.
        isNull(printJobs.claimToken),
        lt(printJobs.updatedAt, before),
      ),
    ).orderBy(printJobs.updatedAt).limit(requestedLimit).for("update");
    await requireManagerActorInTransaction(tx, claims, "jobs.cancel");
    if (candidateIds.length === 0) return 0;
    let count = 0;
    for (let offset = 0; offset < candidateIds.length; offset += RECEIPT_MATERIALIZE_BATCH_ROWS) {
      const batchIds = candidateIds.slice(offset, offset + RECEIPT_MATERIALIZE_BATCH_ROWS).map((row) => row.id);
      const candidates = await tx.select().from(printJobs).where(and(eq(printJobs.tenantId, claims.tenantId), inArray(printJobs.id, batchIds))).for("update");
      // One multi-row INSERT per inner batch (same shape as the automatic
      // retention sweep in cleanupTerminalPrintJobs): a per-row INSERT here
      // costs one round-trip per terminal job, up to MAX_CLEANUP_ROWS statements.
      // No conflict guard is needed — this transaction holds the tenant
      // advisory lock, so no concurrent cleanup can materialize the same
      // receipt id (receipt id = job id, job still locked here).
      if (candidates.length > 0) {
        await tx.insert(printJobReceipts).values(candidates.map((row) => ({
          id: row.id, tenantId: row.tenantId, idempotencyKey: row.idempotencyKey,
          fingerprint: idempotencyDigest({ printerId: row.printerId, documentType: row.documentType, destination: row.destination, payload: row.payload }),
          printerId: row.printerId, agentId: row.agentId, apiKeyId: row.apiKeyId,
          destination: row.destination, documentType: row.documentType, requestedBy: row.requestedBy,
          status: row.status,
        bindingDigest: row.bindingDigest,
        outputMedium: row.outputMedium,
        outputEvidence: row.outputEvidence, error: row.error, closedClaimTokenHash: row.closedClaimTokenHash,
          deliveredAt: row.deliveredAt, ackedAt: row.ackedAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
        })));
      }
      const result = await tx.delete(printJobs).where(and(eq(printJobs.tenantId, claims.tenantId), inArray(printJobs.id, batchIds)));
      count += result.rowCount ?? 0;
    }
    return count;
  });
  } catch (error) {
    if (error instanceof ManagerMutationAuthorityChangedError) return error.response();
    if (error instanceof TenantDeletedError || error instanceof TenantSuspendedError) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }
  return NextResponse.json({ deleted, before: before.toISOString(), limit: requestedLimit });
}
