import { NextResponse } from "next/server";
import { requirePlatformOwner, requirePlatformReadAuthorityInTransaction, PlatformUnauthorizedError } from "../../../../lib/platform-auth";
import { listPrintJobHistory } from "../../../../lib/job-history";
import { isJobFilterStatus } from "../../../../lib/job-status";
import { parseStrictListOffset } from "../../../../lib/request-limits";
import { queryWithTimeout } from "../../../../db/client";
import { db } from "../../../../db";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };

/** Cross-tenant, metadata-only operations feed for verified platform owners. */
export async function GET(req: Request) {
  let actor: Awaited<ReturnType<typeof requirePlatformOwner>>;
  try { actor = await requirePlatformOwner(req); }
  catch (error) {
    return NextResponse.json({ error: error instanceof PlatformUnauthorizedError ? "Unauthorized" : "Platform authentication temporarily unavailable" },
      { status: error instanceof PlatformUnauthorizedError ? 401 : 503, headers: HEADERS });
  }
  const params = new URL(req.url).searchParams;
  const limit = params.get("limit") === null ? 50 : parseStrictListOffset(params.get("limit"), 100);
  const offset = parseStrictListOffset(params.get("offset"), 10_000);
  const status = (params.get("status") ?? "all").toLowerCase();
  const search = (params.get("search") ?? "").trim();
  const tenantId = (params.get("tenantId") ?? "").trim();
  if (!isJobFilterStatus(status)) {
    return NextResponse.json({ error: "Invalid status filter", code: "INVALID_STATUS_FILTER" }, { status: 400, headers: HEADERS });
  }
  if (limit === null || limit < 1 || offset === null) {
    return NextResponse.json({ error: "Invalid operations pagination", code: "INVALID_PAGINATION" }, { status: 400, headers: HEADERS });
  }
  if ((search && (search.length < 2 || search.length > 64)) || tenantId.length > 120) {
    return NextResponse.json({ error: "Invalid operations filter" }, { status: 400, headers: HEADERS });
  }
  try {
    const rows = await queryWithTimeout(() => db.transaction(async tx => {
      await requirePlatformReadAuthorityInTransaction(tx, actor);
      return listPrintJobHistory({
      tenantId: tenantId || undefined,
      status,
      search: search || undefined,
      limit: limit + 1,
      offset,
    }, tx);
    }), 7_000, "platformPrintJobHistory");
    return NextResponse.json({ jobs: rows.slice(0, limit), hasMore: rows.length > limit, limit, offset }, { headers: HEADERS });
  } catch (error) {
    return NextResponse.json({ error: error instanceof PlatformUnauthorizedError ? "Unauthorized" : "Print history temporarily unavailable" },
      { status: error instanceof PlatformUnauthorizedError ? 401 : 503, headers: HEADERS });
  }
}
