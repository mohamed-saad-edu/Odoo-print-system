import { NextResponse } from "next/server";
import { db } from "../../../../db";
import { validateWorkspaceManager } from "../../../../lib/manager-auth";
import { requireManagerPermission } from "../../../../lib/authorization";
import { requireActiveTenantInTransaction, TenantSuspendedError, TenantDeletedError } from "../../../../lib/tenant-guard";
import { requireManagerActorInTransaction, ManagerMutationAuthorityChangedError } from "../../../../lib/manager-mutation-authorization";
import { getAllAgentsHealth, getAgentHealth } from "../../../../lib/agent-health";
import { requestIdFrom, logError } from "../../../../lib/log";
import { runWithCorrelation, generateRequestId } from "../../../../server/correlation";
import { parseStrictListOffset } from "../../../../lib/request-limits";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  const claims = await validateWorkspaceManager(req);
  if (!claims) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  try { requireManagerPermission(claims, "agents.read"); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: HEADERS }); }

  const requestId = requestIdFrom(req) || generateRequestId();
  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId");
  const headers = { ...HEADERS, "x-request-id": requestId };
  const rawLimit = url.searchParams.get("limit");
  const rawOffset = url.searchParams.get("offset");
  const limit = rawLimit === null ? 100 : parseStrictListOffset(rawLimit, Number.MAX_SAFE_INTEGER);
  const offset = parseStrictListOffset(rawOffset, Number.MAX_SAFE_INTEGER);
  if (!agentId && (limit === null || limit < 1 || limit > 200 || offset === null || offset > 100_000)) {
    return NextResponse.json(
      { error: "Invalid pagination", code: "INVALID_PAGINATION" },
      { status: 400, headers },
    );
  }

  return runWithCorrelation({ requestId, tenantId: claims.tenantId, agentId: agentId ?? undefined }, async () => {
    try {
      return await db.transaction(async tx => {
        await requireActiveTenantInTransaction(tx, claims.tenantId);
        await requireManagerActorInTransaction(tx, claims, "agents.read");
        // The health service computes its existing evidence-based projection
        // on THIS transaction's connection; no nested pool checkout while
        // tenant/session locks are held (which could exhaust the pool).
        if (agentId) {
          const health = await getAgentHealth(claims.tenantId, agentId, tx);
          if (!health) return NextResponse.json({ error: "Not found" }, { status: 404, headers });
          return NextResponse.json(health, { headers });
        }
        // The branch above does not use pagination; the check before the
        // transaction establishes these two numeric bounds for list mode.
        const page = await getAllAgentsHealth(claims.tenantId, limit! + 1, offset!, tx);
        const hasMore = page.length > limit!;
        const all = hasMore ? page.slice(0, limit!) : page;
        return NextResponse.json(all, { headers: {
          ...headers,
          "x-page-limit": String(limit),
          "x-page-offset": String(offset),
          "x-has-more": String(hasMore),
          ...(hasMore ? { "x-next-offset": String(offset! + limit!) } : {}),
        } });
      });
    } catch (error) {
      if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers });
      }
      if (error instanceof ManagerMutationAuthorityChangedError) return error.response();
      logError("agent.health_read_failed", { tenantId: claims.tenantId, agentId, error: error instanceof Error ? error.message : "unknown" });
      return NextResponse.json({ error: "Agent health unavailable", code: "AGENT_HEALTH_UNAVAILABLE" }, { status: 503, headers });
    }
  });
}
