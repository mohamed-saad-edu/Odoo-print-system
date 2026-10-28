import { hasBodyOverLimit } from "../../../../lib/request-limits";
import { ActionError } from "../../../../lib/action-error";
import { NextResponse } from "next/server";
import { db } from "../../../../db";
import { agents, printers, printJobs } from "../../../../db/schema";
import { validateWorkspaceManager } from "../../../../lib/manager-auth";
import { requireManagerActorInTransaction, ManagerMutationAuthorityChangedError } from "../../../../lib/manager-mutation-authorization";
import { requireActiveTenantInTransaction, TenantSuspendedError, TenantDeletedError } from "../../../../lib/tenant-guard";
import { requireManagerPermission } from "../../../../lib/authorization";
import { eq, count, desc, and } from "drizzle-orm";
import { z } from "zod";
import { transitionAgentLifecycle, LifecycleConflict } from "../../../../lib/agent-lifecycle";
import { logError } from "../../../../lib/log";
import { agentStaleThresholdSeconds, getAgentHeartbeatFreshness, getEffectiveAgentStatus, getEffectivePrinterStatus } from "../../../../lib/agent-availability";
import { gatewayNow, refreshClockSkew } from "../../../../lib/database-clock";
import { isTenantBillingError } from "../../../../lib/entitlements";
import { isVirtualPrinterRecord } from "../../../../lib/printer-virtual";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };
const patchSchema = z.object({ lifecycle: z.enum(["active", "disabled", "retired"]) }).strict();

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await validateWorkspaceManager(req);
  if (!claims) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  // Same coded ActionError shape as PATCH so clients parse one
  // authorization-failure contract across the route.
  try { requireManagerPermission(claims, "agents.read"); } catch { const e = new ActionError("Forbidden", 403, "FORBIDDEN"); return NextResponse.json({ error: e.message, code: e.code, ...(e.details ?? {}) }, { status: e.status, headers: PRIVATE_HEADERS }); }
  const { id } = await params;
  await refreshClockSkew();
  const now = gatewayNow();

  // Preflight session permission is not sufficient for the three confidential
  // reads below: a workspace may be suspended or the manager logged out while
  // one of them waits on a concurrent update. Hold the same tenant/session
  // authority locks through agent, printer and job-count queries.
  let detail;
  try {
    detail = await db.transaction(async tx => {
      await requireActiveTenantInTransaction(tx, claims.tenantId);
      await requireManagerActorInTransaction(tx, claims, "agents.read");
      const agent = await tx.query.agents.findFirst({
        where: and(eq(agents.id, id), eq(agents.tenantId, claims.tenantId)),
      });
      if (!agent) return null;
      const agentPrinters = await tx.query.printers.findMany({
        where: and(eq(printers.agentId, id), eq(printers.tenantId, claims.tenantId), eq(printers.sharedWithGateway, true)),
        orderBy: [desc(printers.createdAt)],
      });
      const [jobs] = await tx.select({ c: count() }).from(printJobs)
        .where(and(eq(printJobs.agentId, id), eq(printJobs.tenantId, claims.tenantId)));
      return { agent, agentPrinters, jobCount: jobs?.c ?? 0 };
    });
  } catch (error) {
    if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: PRIVATE_HEADERS });
    }
    if (error instanceof ManagerMutationAuthorityChangedError) return error.response();
    logError("agent.detail_read_failed", { agentId: id, error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Agent details unavailable", code: "AGENT_DETAILS_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS });
  }
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404, headers: PRIVATE_HEADERS });
  const { agent, agentPrinters, jobCount } = detail;
  const { secret: _secret, pairingCodeHash: _pch, pairingCode: _pc, pairingCodeExpiresAt: _exp, ...safe } = agent as Record<string, unknown>;
  const safeAgent = {
    ...safe,
    reportedStatus: agent.status,
    freshness: getAgentHeartbeatFreshness(agent.lastSeenAt, now),
    status: getEffectiveAgentStatus(agent, now),
    staleThresholdSeconds: agentStaleThresholdSeconds(),
  };
  const effectivePrinters = agentPrinters.filter((printer) => !isVirtualPrinterRecord(printer)).map((printer) => ({ ...printer, status: getEffectivePrinterStatus(printer, agent, now) }));
  return NextResponse.json({ agent: safeAgent, printers: effectivePrinters, jobCount }, { headers: PRIVATE_HEADERS });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (hasBodyOverLimit(req, 16 * 1024)) return NextResponse.json({ error: "Request body too large", code: "INVALID_REQUEST" }, { status: 413 });
  const claims = await validateWorkspaceManager(req);
  if (!claims) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let body: unknown; try { const parsedBody = await req.json(); if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) throw new Error("JSON object required"); body = parsedBody; } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "lifecycle is required" }, { status: 400 });
  const { lifecycle } = parsed.data;
  // Retiring an agent is a destructive, history-gating transition (see
  // deleteAgent's agents.retire gate in actions.ts). It must require the
  // retire permission even on the API path; disable alone is insufficient.
  try { requireManagerPermission(claims, lifecycle === "retired" ? "agents.retire" : "agents.disable"); } catch { const e = new ActionError("Forbidden", 403, "FORBIDDEN"); return NextResponse.json({ error: e.message, code: e.code, ...(e.details ?? {}) }, { status: e.status }); }
  try {
    const result = await transitionAgentLifecycle(id, lifecycle, claims.tenantId, { type: "user", id: claims.userId ?? null }, claims);
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, lifecycle: result.lifecycle, pairingCode: result.pairingCode });
  } catch (error) {
    if (error instanceof ManagerMutationAuthorityChangedError) return error.response();
    if (error instanceof LifecycleConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    if (isTenantBillingError(error)) return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
    logError("agent.lifecycle_failed", { agentId: id, error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
