import { NextResponse } from "next/server";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../../../../db";
import { agents, printers, tenants } from "../../../../db/schema";
import { queryWithTimeout } from "../../../../db/client";
import { requirePlatformOwner, PlatformUnauthorizedError } from "../../../../lib/platform-auth";
import { nonVirtualPrinterPredicate } from "../../../../lib/printer-virtual-sql";
import { databaseNowMs } from "../../../../lib/database-clock";
import { getEffectiveAgentStatus, getEffectivePrinterStatus } from "../../../../lib/agent-availability";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };
/** Read-only, cross-tenant inventory; transport secrets/config are never projected. */
export async function GET(req: Request) {
  try { await requirePlatformOwner(req); }
  catch (error) {
    return NextResponse.json({ error: error instanceof PlatformUnauthorizedError ? "Unauthorized" : "Platform authentication temporarily unavailable" },
      { status: error instanceof PlatformUnauthorizedError ? 401 : 503, headers: HEADERS });
  }
  const q = new URL(req.url).searchParams;
  const kind = q.get("kind") ?? "agents";
  const status = q.get("status") ?? "all";
  const tenantId = (q.get("tenantId") ?? "").trim();
  const search = (q.get("search") ?? "").trim().toLowerCase();
  const limit = Number(q.get("limit") ?? "40");
  const offset = Number(q.get("offset") ?? "0");
  if (!["agents", "printers"].includes(kind) ||
      !["all", "active", "disabled", "retired"].includes(status) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 10_000 ||
      tenantId.length > 120 || (search && (search.length < 2 || search.length > 64))) {
    return NextResponse.json({ error: "Invalid inventory filter" }, { status: 400, headers: HEADERS });
  }
  const term = `%${search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
  const clauses: SQL[] = [];
  if (kind === "agents") {
    if (tenantId) clauses.push(eq(agents.tenantId, tenantId));
    if (status !== "all") clauses.push(eq(agents.lifecycle, status));
    if (search) clauses.push(sql`(LOWER(${agents.id}) LIKE ${term} ESCAPE '\\' OR LOWER(${agents.name}) LIKE ${term} ESCAPE '\\' OR LOWER(${tenants.name}) LIKE ${term} ESCAPE '\\')`);
    try {
      const rows = await queryWithTimeout(() => db.select({
        id: agents.id, tenantId: agents.tenantId, tenantName: tenants.name,
        name: agents.name, lifecycle: agents.lifecycle, status: agents.status,
        lastSeenAt: agents.lastSeenAt, createdAt: agents.createdAt,
      }).from(agents).innerJoin(tenants, eq(tenants.id, agents.tenantId))
        .where(and(...clauses)).orderBy(desc(agents.createdAt), desc(agents.id))
        .limit(limit + 1).offset(offset), 6_000, "platformAgentInventory");
      const observedAt = new Date(await databaseNowMs());
      return NextResponse.json({ items: rows.slice(0, limit).map(row => ({ ...row, reportedStatus: row.status, status: getEffectiveAgentStatus(row, observedAt) })), hasMore: rows.length > limit, kind, limit, offset, observedAt: observedAt.toISOString() }, { headers: HEADERS });
    } catch {
      return NextResponse.json({ error: "Agent inventory unavailable" }, { status: 503, headers: HEADERS });
    }
  }
  if (tenantId) clauses.push(eq(printers.tenantId, tenantId));
  // Platform inventory shows removed/tombstoned printers only in the explicit
  // retired filter, never as active devices in the default fleet list.
  if (status !== "retired") clauses.push(sql`NOT (${printers.lifecycle} = 'retired' AND ${printers.sharedWithGateway} = false)`);
  if (status !== "all") clauses.push(eq(printers.lifecycle, status));
  if (search) clauses.push(sql`(LOWER(${printers.id}) LIKE ${term} ESCAPE '\\' OR LOWER(${printers.name}) LIKE ${term} ESCAPE '\\' OR LOWER(${tenants.name}) LIKE ${term} ESCAPE '\\')`);
  try {
    const rows = await queryWithTimeout(() => db.select({
      id: printers.id, tenantId: printers.tenantId, tenantName: tenants.name,
      name: printers.name, lifecycle: printers.lifecycle, status: printers.status,
      lastSeenAt: printers.lastSeenAt, createdAt: printers.createdAt,
      agentId: printers.agentId, agentName: agents.name,
      protocol: printers.protocol, connectionType: printers.connectionType,
      inventoryPresent: printers.inventoryPresent, sharedWithGateway: printers.sharedWithGateway,
    }).from(printers).innerJoin(tenants, eq(tenants.id, printers.tenantId))
      .innerJoin(agents, and(eq(agents.id, printers.agentId), eq(agents.tenantId, printers.tenantId)))
      .where(and(...clauses, nonVirtualPrinterPredicate()))
      .orderBy(desc(printers.createdAt), desc(printers.id))
      .limit(limit + 1).offset(offset), 6_000, "platformPrinterInventory");
    const observedAt = new Date(await databaseNowMs());
    return NextResponse.json({ items: rows.slice(0, limit).map(row => ({ ...row, reportedStatus: row.status, status: getEffectivePrinterStatus(row, undefined, observedAt) })), hasMore: rows.length > limit, kind, limit, offset, observedAt: observedAt.toISOString() }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "Printer inventory unavailable" }, { status: 503, headers: HEADERS });
  }
}
