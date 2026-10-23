import { NextResponse } from "next/server";
import { requirePlatformOwner, PlatformUnauthorizedError } from "../../../../lib/platform-auth";
import { listPrintJobHistory } from "../../../../lib/job-history";
import { isJobFilterStatus } from "../../../../lib/job-status";
import { queryWithTimeout } from "../../../../db/client";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };

/** Cross-tenant, metadata-only operations feed for verified platform owners. */
export async function GET(req: Request) {
  try { await requirePlatformOwner(req); }
  catch (error) {
    return NextResponse.json({ error: error instanceof PlatformUnauthorizedError ? "Unauthorized" : "Auth unavailable" },
      { status: error instanceof PlatformUnauthorizedError ? 401 : 503, headers: HEADERS });
  }
  const params = new URL(req.url).searchParams;
  const limit = Number(params.get("limit") ?? "50");
  const offset = Number(params.get("offset") ?? "0");
  const status = (params.get("status") ?? "all").toLowerCase();
  const search = (params.get("search") ?? "").trim();
  const tenantId = (params.get("tenantId") ?? "").trim();
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 10_000 ||
      !isJobFilterStatus(status) || (search && (search.length < 2 || search.length > 64)) ||
      tenantId.length > 120) {
    return NextResponse.json({ error: "Invalid operations filter" }, { status: 400, headers: HEADERS });
  }
  try {
    const rows = await queryWithTimeout(() => listPrintJobHistory({
      tenantId: tenantId || undefined,
      status,
      search: search || undefined,
      limit: limit + 1,
      offset,
    }), 7_000, "platformPrintJobHistory");
    return NextResponse.json({ jobs: rows.slice(0, limit), hasMore: rows.length > limit, limit, offset }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "Print history temporarily unavailable" }, { status: 503, headers: HEADERS });
  }
}
