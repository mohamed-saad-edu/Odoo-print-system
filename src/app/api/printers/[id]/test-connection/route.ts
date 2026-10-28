import { NextResponse } from "next/server";
import { db } from "../../../../../db";
import { printers, agents } from "../../../../../db/schema";
import { validateConsoleAuth } from "../../../../../lib/console-auth";
import { requireManagerPermission } from "../../../../../lib/authorization";
import { requireConsoleReadAuthorityInTransaction, ConsoleAgentAuthorityRevokedError } from "../../../../../lib/console-read-authority";
import { requireActiveTenantInTransaction, TenantSuspendedError, TenantDeletedError } from "../../../../../lib/tenant-guard";
import { ManagerMutationAuthorityChangedError } from "../../../../../lib/manager-mutation-authorization";
import { logError } from "../../../../../lib/log";
import { and, eq } from "drizzle-orm";
import { getAgentAvailability, isPrinterObservationFresh } from "../../../../../lib/agent-availability";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

// Diagnostic endpoint. This build intentionally reports cached heartbeat state,
// not a live LAN probe. `live: false` is part of the response contract so UIs
// cannot present cached reachability as a just-tested TCP result.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateConsoleAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  if (auth.kind === "manager") {
    try { requireManagerPermission(auth.claims, "printers.test"); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE_HEADERS }); }
  }

  const tenantId = auth.kind === "manager" ? auth.claims.tenantId : auth.agent.tenantId;
  const { id } = await params;
  // A cached device/Agent diagnostic still contains tenant-private fleet
  // information. Authorization preflight can become stale before these
  // independent reads; hold current tenant, session/role or Agent-secret
  // authority through both rows in the same PostgreSQL transaction.
  let detail;
  try {
    detail = await db.transaction(async tx => {
      await requireConsoleReadAuthorityInTransaction(tx, auth, "printers.test");
      const printer = await tx.query.printers.findFirst({
        where: auth.kind === "agent"
          ? and(eq(printers.id, id), eq(printers.tenantId, tenantId), eq(printers.agentId, auth.agent.id))
          : and(eq(printers.id, id), eq(printers.tenantId, tenantId)),
      });
      if (!printer) return null;
      const agent = await tx.query.agents.findFirst({
        where: and(eq(agents.id, printer.agentId), eq(agents.tenantId, tenantId)),
      });
      return { printer, agent };
    });
  } catch (error) {
    if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: PRIVATE_HEADERS });
    }
    if (error instanceof ManagerMutationAuthorityChangedError) return error.response();
    if (error instanceof ConsoleAgentAuthorityRevokedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: PRIVATE_HEADERS });
    }
    logError("printer.connection_diagnostic_read_failed", { printerId: id, tenantId, error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Printer diagnostic unavailable", code: "PRINTER_DIAGNOSTIC_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS });
  }
  if (!detail) return NextResponse.json({ error: "Printer not found" }, { status: 404, headers: PRIVATE_HEADERS });
  const { printer, agent } = detail;
  if (!agent) return NextResponse.json({
    reachable: false,
    latencyMs: null,
    live: false,
    lastHeartbeatAt: null,
    agentOnline: false,
    agentAvailabilityReason: "agent_not_found",
    error: "agent not found",
  }, { status: 404, headers: PRIVATE_HEADERS });

  const availability = getAgentAvailability(agent);
  const agentState = {
    lastHeartbeatAt: agent.lastSeenAt,
    agentOnline: availability.available,
    agentAvailabilityReason: availability.reason,
  };

  if (printer.lifecycle !== "active") {
    return NextResponse.json({
      reachable: false,
      latencyMs: null,
      live: false,
      ...agentState,
      error: "printer disabled",
    }, { headers: PRIVATE_HEADERS });
  }

  const cfg = (printer.config ?? {}) as Record<string, unknown>;
  if (printer.connectionType === "network" && (!cfg.ip || !cfg.port)) {
    return NextResponse.json({
      reachable: false,
      latencyMs: null,
      live: false,
      ...agentState,
      error: "missing ip/port in config",
    }, { headers: PRIVATE_HEADERS });
  }

  if (!availability.available) {
    return NextResponse.json({
      reachable: false,
      latencyMs: null,
      live: false,
      ...agentState,
      error: `agent unavailable (${availability.reason}) — printer reachability unknown until agent availability is restored`,
    }, { headers: PRIVATE_HEADERS });
  }

  const printerFresh = isPrinterObservationFresh(printer.lastSeenAt);
  const reachable = (printer.status === "online" || printer.status === "busy") && availability.available && printerFresh;
  return NextResponse.json({
    reachable,
    latencyMs: null,
    live: false,
    ...agentState,
    printerLastSeenAt: printer.lastSeenAt,
    printerObservationFresh: printerFresh,
    error: reachable ? null : !printerFresh ? "printer observation is stale or missing" : `last heartbeat printer.status=${printer.status}`,
  }, { headers: PRIVATE_HEADERS });
}
