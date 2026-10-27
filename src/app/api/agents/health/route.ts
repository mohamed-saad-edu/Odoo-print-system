import { NextResponse } from "next/server";
import { validateWorkspaceManager } from "../../../../lib/manager-auth";
import { requireManagerPermission } from "../../../../lib/authorization";
import { getAllAgentsHealth, getAgentHealth } from "../../../../lib/agent-health";
import { requestIdFrom } from "../../../../lib/log";
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

  return runWithCorrelation({ requestId, tenantId: claims.tenantId, agentId: agentId ?? undefined }, async () => {
    if (agentId) {
      const health = await getAgentHealth(claims.tenantId, agentId);
      if (!health) return NextResponse.json({ error: "Not found" }, { status: 404, headers: { ...HEADERS, "x-request-id": requestId } });
      return NextResponse.json(health, { headers: { ...HEADERS, "x-request-id": requestId } });
    }
    const rawLimit = url.searchParams.get("limit");
    const rawOffset = url.searchParams.get("offset");
    const limit = rawLimit === null ? 100 : parseStrictListOffset(rawLimit, Number.MAX_SAFE_INTEGER);
    const offset = parseStrictListOffset(rawOffset, Number.MAX_SAFE_INTEGER);
    if (limit === null || limit < 1 || limit > 200 || offset === null || offset > 100_000) {
      return NextResponse.json(
        { error: "Invalid pagination", code: "INVALID_PAGINATION" },
        { status: 400, headers: { ...HEADERS, "x-request-id": requestId } },
      );
    }
    const page = await getAllAgentsHealth(claims.tenantId, limit + 1, offset);
    const hasMore = page.length > limit;
    const all = hasMore ? page.slice(0, limit) : page;
    return NextResponse.json(all, { headers: {
      ...HEADERS,
      "x-request-id": requestId,
      "x-page-limit": String(limit),
      "x-page-offset": String(offset),
      "x-has-more": String(hasMore),
      ...(hasMore ? { "x-next-offset": String(offset + limit) } : {}),
    } });
  });
}
