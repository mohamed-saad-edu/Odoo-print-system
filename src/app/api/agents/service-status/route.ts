import { NextResponse } from "next/server";
import { db } from "../../../../db";
import { agents } from "../../../../db/schema";
import { and, eq } from "drizzle-orm";
import { isValidAgentId } from "../../../../lib/agent-auth";
import { requireActiveTenantInTransaction, TenantSuspendedError, TenantDeletedError } from "../../../../lib/tenant-guard";
import { requireManagerActorInTransaction, ManagerMutationAuthorityChangedError } from "../../../../lib/manager-mutation-authorization";
import { validateWorkspaceManager } from "../../../../lib/manager-auth";
import { requireManagerPermission } from "../../../../lib/authorization";
import { requestIdFrom, logError } from "../../../../lib/log";
import { runWithCorrelation } from "../../../../server/correlation";

export const dynamic = "force-dynamic";

/**
 * Windows Service Recovery status — enterprise requirement
 * Live SCM observations are not implemented here. Return BLOCKED with
 * configured recovery defaults and explicit unknown observation fields.
 */

export async function GET(req: Request) {
  const claims = await validateWorkspaceManager(req);
  if (!claims) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { requireManagerPermission(claims, "agents.read"); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

  const requestId = requestIdFrom(req);
  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId");
  if (!isValidAgentId(agentId)) return NextResponse.json({ error: "Valid agentId required", code: "INVALID_AGENT_ID" }, { status: 400 });

  return runWithCorrelation({ requestId, tenantId: claims.tenantId, agentId: agentId ?? undefined }, async () => {
    // The endpoint cannot inspect a remote Windows SCM, but it MUST still
    // validate the exact requested Agent is owned by the authenticated tenant.
    // A forged or stale ID must never produce plausible status metadata.
    try {
      const owned = await db.transaction(async tx => {
        await requireActiveTenantInTransaction(tx, claims.tenantId);
        await requireManagerActorInTransaction(tx, claims, "agents.read");
        return tx.query.agents.findFirst({
          where: and(eq(agents.id, agentId), eq(agents.tenantId, claims.tenantId)),
          columns: { id: true },
        });
      });
      if (!owned) return NextResponse.json({ error: "Agent not found", code: "AGENT_NOT_FOUND" }, { status: 404 });
    } catch (error) {
      if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }
      if (error instanceof ManagerMutationAuthorityChangedError) return error.response();
      logError("agent.service_status_read_failed", { error: error instanceof Error ? error.message : "unknown" });
      return NextResponse.json({ error: "Service status unavailable", code: "SERVICE_STATUS_UNAVAILABLE" }, { status: 503 });
    }
    // This endpoint does not query the remote Agent's SCM on any host.
    // Recovery timings below are configured defaults, not observed policy.
    // Service identity must match the actual registration in
    // agent/cmd/agent/main.go (service.Config{Name: "YaseirAgent"}) and the
    // SERVICE_NAME constant in src-tauri/src/agent.rs. The recovery timings
    // match configureServiceRecovery: three `restart/60000` actions + one-day
    // reset counter. The status body remains BLOCKED until live observations exist,
    // but it must never state a different service name or recovery schedule
    // than the one the installers actually apply.
    const blockedStatus = {
      agentId,
      serviceName: "YaseirAgent",
      displayName: "Yaseir Agent",
      state: "UNKNOWN" as const,
      startType: "AUTOMATIC" as const,
      recovery: {
        firstFailure: "restart/60000",
        secondFailure: "restart/60000",
        subsequentFailure: "restart/60000",
        resetPeriodSec: 86400,
        // The installer does not set the non-crash failure flag, and this
        // endpoint cannot observe the installed SCM value.
        failureFlag: null,
      },
      lastRestart: null,
      // Failure history is not measured by this sandbox endpoint.
      failureCount: null,
      // The sandbox cannot observe an SCM process exit code either; null keeps
      // this blocked diagnostic honest instead of presenting a synthetic success code.
      exitCode: null,
      uptimeSeconds: null,
      blocked: true,
      blockedReason: "BLOCKED: Live Windows Service Control Manager observation requires Windows host with the service installed and is not implemented by this endpoint. Configured recovery defaults are not measured service status. See docs/WINDOWS_SERVICE_RECOVERY.md for the recovery test procedure.",
      instructions: "Follow docs/WINDOWS_SERVICE_RECOVERY.md to verify the installation, process path and creation time before any crash test, observe SCM recovery, then confirm a fresh authenticated Gateway heartbeat.",
      correlation: { requestId, tenantId: claims.tenantId, agentId },
    };

    return NextResponse.json(blockedStatus, { headers: { "x-request-id": requestId } });
  });
}
