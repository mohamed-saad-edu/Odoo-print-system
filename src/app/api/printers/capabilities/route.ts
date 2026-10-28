import { NextResponse } from "next/server";
import { db } from "../../../../db";
import { validateWorkspaceManager } from "../../../../lib/manager-auth";
import { requireManagerPermission } from "../../../../lib/authorization";
import { requireActiveTenantInTransaction, TenantSuspendedError, TenantDeletedError } from "../../../../lib/tenant-guard";
import { requireManagerActorInTransaction, ManagerMutationAuthorityChangedError } from "../../../../lib/manager-mutation-authorization";
import { getPrinterCapabilityPageInTransaction, getPrinterCapabilityMatrixInTransaction } from "../../../../lib/printer-health";
import { clampListLimit } from "../../../../lib/request-limits";
import { requestIdFrom, logError } from "../../../../lib/log";
import { runWithCorrelation, generateRequestId } from "../../../../server/correlation";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  const claims = await validateWorkspaceManager(req);
  if (!claims) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  try { requireManagerPermission(claims, "printers.read"); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE_HEADERS }); }

  const requestId = requestIdFrom(req) || generateRequestId();
  const url = new URL(req.url);
  const printerId = url.searchParams.get("printerId");
  const headers: Record<string, string> = { "x-request-id": requestId, "Cache-Control": "private, no-store" };
  const cursor = url.searchParams.get("after");
  let afterId: string | undefined;
  if (!printerId && cursor !== null) {
    if (!/^[A-Za-z0-9_-]{1,640}$/.test(cursor)) {
      return NextResponse.json({ error: "Invalid capability page cursor" }, { status: 400, headers });
    }
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (decoded.length < 1 || decoded.length > 120 || Buffer.from(decoded, "utf8").toString("base64url") !== cursor) {
      return NextResponse.json({ error: "Invalid capability page cursor" }, { status: 400, headers });
    }
    afterId = decoded;
  }
  const limit = clampListLimit(url.searchParams.get("limit"), 100, 1000);

  return runWithCorrelation({ requestId, tenantId: claims.tenantId, printerId: printerId ?? undefined }, async () => {
    // Preflight JWT/cookie validation can become stale while PostgreSQL is
    // reading the capabilities. Lock current tenant, membership and session
    // before both matrix and page SELECTs, using the same connection for all.
    let result;
    try {
      result = await db.transaction(async tx => {
        await requireActiveTenantInTransaction(tx, claims.tenantId);
        await requireManagerActorInTransaction(tx, claims, "printers.read");
        if (printerId) return { kind: "one" as const,
          value: await getPrinterCapabilityMatrixInTransaction(tx, claims.tenantId, printerId) };
        return { kind: "page" as const,
          value: await getPrinterCapabilityPageInTransaction(tx, claims.tenantId, { limit, afterId }) };
      });
    } catch (error) {
      if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers });
      }
      if (error instanceof ManagerMutationAuthorityChangedError) return error.response();
      logError("printer.capability_read_failed", { tenantId: claims.tenantId, error: error instanceof Error ? error.message : "unknown" });
      return NextResponse.json({ error: "Printer capabilities unavailable", code: "PRINTER_CAPABILITIES_UNAVAILABLE" }, { status: 503, headers });
    }

    if (result.kind === "one") {
      if (!result.value) return NextResponse.json({ error: "Not found" }, { status: 404, headers });
      return NextResponse.json(result.value, { headers });
    }
    headers["X-Has-More"] = String(result.value.hasMore);
    if (result.value.nextCursor) headers["X-Next-Cursor"] = result.value.nextCursor;
    return NextResponse.json(result.value.items, { headers });
  });
}
