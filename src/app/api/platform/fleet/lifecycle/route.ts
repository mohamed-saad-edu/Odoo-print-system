import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { platformActionReason } from "../../../../../lib/platform-action-confirmation";
import { db } from "../../../../../db";
import { agents, printers } from "../../../../../db/schema";
import {
  requirePlatformOwner, requirePlatformActorInTransaction,
  PlatformUnauthorizedError, PlatformMutationAuthorityChangedError,
} from "../../../../../lib/platform-auth";
import { requireActiveTenantInTransaction, TenantSuspendedError, TenantDeletedError } from "../../../../../lib/tenant-guard";
import { requireTenantBillingAccess, isTenantBillingError } from "../../../../../lib/entitlements";
import { generatePairingCode, hashPairingCode } from "../../../../../lib/agent-auth";
import { canTransitionLifecycle } from "../../../../../lib/lifecycle";
import { hasBodyOverLimit } from "../../../../../lib/request-limits";
import { writeAuditEvent } from "../../../../../lib/audit";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };

const bodySchema = z.object({
  kind: z.enum(["agents", "printers"]),
  tenantId: z.string().min(1).max(120),
  id: z.string().min(1).max(150),
  expectedLifecycle: z.enum(["active", "disabled"]),
  nextLifecycle: z.enum(["active", "disabled"]),
  reason: z.string().trim().max(300).optional(),
}).strict();

/**
 * Explicit, audited platform-owner operational lifecycle management.
 * Never bypasses the live agent/printer control protocol: disabling revokes
 * agent credentials; re-enabling requires a NEW pairing code (returned once).
 * This endpoint deliberately does not expose retirement, force-print, job
 * replay, or arbitrary Gateway configuration changes.
 */
export async function POST(req: Request) {
  let claims;
  try { claims = await requirePlatformOwner(req); }
  catch (error) {
    return NextResponse.json({ error: error instanceof PlatformUnauthorizedError ? "Unauthorized" : "Platform authentication temporarily unavailable" },
      { status: error instanceof PlatformUnauthorizedError ? 401 : 503, headers: HEADERS });
  }
  if (hasBodyOverLimit(req, 8 * 1024)) return NextResponse.json({ error: "Request too large" }, { status: 413, headers: HEADERS });
  const input = bodySchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Invalid lifecycle operation" }, { status: 400, headers: HEADERS });
  const { kind, tenantId, id, expectedLifecycle, nextLifecycle } = input.data;
  const reason = platformActionReason(input.data.reason, "device lifecycle change");
  if (nextLifecycle === expectedLifecycle) return NextResponse.json({ error: "No lifecycle change requested" }, { status: 400, headers: HEADERS });

  try {
    const result = await db.transaction(async (tx) => {
      // Activation additionally checks active tenancy and billing under locks.
      if (nextLifecycle === "active") await requireActiveTenantInTransaction(tx, tenantId);
      // Keep tenant -> device -> actor order even when disabling. The later
      // audit FK must not wait for a Workspace transition that holds the tenant
      // while waiting for our actor. Disablement is allowed while suspended.
      else await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR SHARE`);

      if (kind === "agents") {
        const existing = await tx.select({
          id: agents.id, lifecycle: agents.lifecycle, lifecycleRevision: agents.lifecycleRevision,
        }).from(agents).where(and(eq(agents.id, id), eq(agents.tenantId, tenantId))).for("update");
        const row = existing[0];
        if (!row) return { status: 404, error: "Agent not found" } as const;
        if (row.lifecycle !== expectedLifecycle || !canTransitionLifecycle(row.lifecycle, nextLifecycle)) {
          return { status: 409, error: "Agent lifecycle changed; reload the inventory" } as const;
        }
        await requirePlatformActorInTransaction(tx, claims);
        if (nextLifecycle === "active") await requireTenantBillingAccess(tx, tenantId);
        let pairingCode: string | null = null;
        if (nextLifecycle === "active") {
          for (let i = 0; i < 5; i++) {
            const candidate = generatePairingCode();
            const hash = hashPairingCode(candidate);
            const other = await tx.query.agents.findFirst({ where: eq(agents.pairingCodeHash, hash), columns: { id: true } });
            if (!other || other.id === id) { pairingCode = candidate; break; }
          }
          if (!pairingCode) throw new Error("Unable to allocate a pairing code");
        }
        const revision = row.lifecycleRevision + 1;
        await tx.update(agents).set({
          lifecycle: nextLifecycle, status: "offline", secret: null,
          pairingCodeHash: pairingCode ? hashPairingCode(pairingCode) : null,
          pairingCodeExpiresAt: pairingCode ? sql`clock_timestamp() + interval '10 minutes'` : null,
          lifecycleRevision: revision, updatedAt: sql`clock_timestamp()`,
        }).where(and(eq(agents.id, id), eq(agents.tenantId, tenantId), eq(agents.lifecycle, expectedLifecycle)));
        await writeAuditEvent({ tenantId, actorType: "platform", actorId: claims.userId,
          action: `agent.lifecycle.${nextLifecycle}`, resourceType: "agent", resourceId: id,
          metadata: { from: expectedLifecycle, to: nextLifecycle, reason } }, tx);
        await tx.execute(sql`SELECT pg_notify('print_gateway_agent_sessions', ${JSON.stringify({ agentId: id, lifecycleRevision: revision })}::text)`);
        return { status: 200, ok: true, kind, id, tenantId, lifecycle: nextLifecycle, pairingCode } as const;
      }

      // Lock the owner Agent first, as in the manager printer control path.
      const preliminary = await tx.select({ agentId: printers.agentId })
        .from(printers).where(and(eq(printers.id, id), eq(printers.tenantId, tenantId))).limit(1);
      if (!preliminary[0]) return { status: 404, error: "Printer not found" } as const;
      const owners = await tx.select({ id: agents.id, lifecycle: agents.lifecycle })
        .from(agents).where(and(eq(agents.id, preliminary[0].agentId), eq(agents.tenantId, tenantId))).for("update");
      const existing = await tx.select({
        id: printers.id, lifecycle: printers.lifecycle, printerType: printers.printerType,
        inventoryPresent: printers.inventoryPresent, agentId: printers.agentId,
      }).from(printers).where(and(eq(printers.id, id), eq(printers.tenantId, tenantId))).for("update");
      const row = existing[0];
      if (!row || !owners[0] || row.agentId !== owners[0].id) return { status: 409, error: "Printer owner changed" } as const;
      if (row.lifecycle !== expectedLifecycle || !canTransitionLifecycle(row.lifecycle, nextLifecycle)) {
        return { status: 409, error: "Printer lifecycle changed; reload the inventory" } as const;
      }
      if (row.printerType !== "physical") return { status: 409, error: "Virtual printer cannot be managed" } as const;
      if (nextLifecycle === "active" && (!row.inventoryPresent || owners[0].lifecycle !== "active")) {
        return { status: 409, error: "Printer must be present with an active Agent" } as const;
      }
      await requirePlatformActorInTransaction(tx, claims);
      if (nextLifecycle === "active") await requireTenantBillingAccess(tx, tenantId);
      await tx.update(printers).set({
        lifecycle: nextLifecycle, managementSource: "manager",
        desiredRevision: sql<number>`${printers.desiredRevision} + 1`,
        updatedAt: sql`clock_timestamp()`,
      }).where(and(eq(printers.id, id), eq(printers.tenantId, tenantId), eq(printers.agentId, owners[0].id)));
      await writeAuditEvent({ tenantId, actorType: "platform", actorId: claims.userId,
        action: `printer.lifecycle.${nextLifecycle}`, resourceType: "printer", resourceId: id,
        metadata: { from: expectedLifecycle, to: nextLifecycle, reason } }, tx);
      return { status: 200, ok: true, kind, id, tenantId, lifecycle: nextLifecycle } as const;
    });
    return NextResponse.json(result, { status: result.status, headers: HEADERS });
  } catch (error) {
    if (error instanceof PlatformMutationAuthorityChangedError) return NextResponse.json({ error: error.message }, { status: 403, headers: HEADERS });
    if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError || isTenantBillingError(error)) {
      return NextResponse.json({ error: error.message }, { status: 403, headers: HEADERS });
    }
    return NextResponse.json({ error: "Lifecycle operation unavailable" }, { status: 503, headers: HEADERS });
  }
}
