import { NextResponse } from "next/server";
import { db } from "../../../../../../db";
import { discoverySessions, discoveredDevices } from "../../../../../../db/schema";
import { validateWorkspaceManager } from "../../../../../../lib/manager-auth";
import { requireManagerPermission } from "../../../../../../lib/authorization";
import { requireManagerActorInTransaction, ManagerMutationAuthorityChangedError } from "../../../../../../lib/manager-mutation-authorization";
import { requireActiveTenantInTransaction, TenantSuspendedError, TenantDeletedError } from "../../../../../../lib/tenant-guard";
import { logError } from "../../../../../../lib/log";
import { eq, and, sql } from "drizzle-orm";
import { discoveryObservationFingerprint } from "../../../../../../lib/discovery-observation";
import { expireStaleAgentDiscovery } from "../../../../../../lib/discovery-session-expiry";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(req: Request, { params }: { params: Promise<{ id: string; discoveryId: string }> }) {
  const claims = await validateWorkspaceManager(req);
  if (!claims) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  try { requireManagerPermission(claims, "agents.read"); } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const { id: agentId, discoveryId } = await params;
  let snapshot;
  try {
    snapshot = await db.transaction(async tx => {
      await requireActiveTenantInTransaction(tx, claims.tenantId);
      // Match scan-start lock order: Tenant -> Agent -> Actor -> session.
      // A revoked manager must not expire a scan or read an old inventory.
      const owner = await tx.execute(sql`SELECT id FROM agents
        WHERE id = ${agentId} AND tenant_id = ${claims.tenantId} FOR SHARE`);
      if (!owner.rows.length) return null;
      await requireManagerActorInTransaction(tx, claims, "agents.read");
      await expireStaleAgentDiscovery(query => tx.execute(query), claims.tenantId, agentId);
      const session = await tx.query.discoverySessions.findFirst({
        where: and(eq(discoverySessions.id, discoveryId),
          eq(discoverySessions.agentId, agentId), eq(discoverySessions.tenantId, claims.tenantId)),
      });
      if (!session) return null;
      // The same Agent-scoped FK/identity check guards both session and rows.
      const devices = await tx.query.discoveredDevices.findMany({
        where: and(eq(discoveredDevices.discoveryId, discoveryId),
          eq(discoveredDevices.agentId, agentId), eq(discoveredDevices.tenantId, claims.tenantId)),
      });
      return { session, devices };
    });
  } catch (error) {
    if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError)
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: PRIVATE_HEADERS });
    if (error instanceof ManagerMutationAuthorityChangedError) return error.response();
    logError("agent.discovery_detail_read_failed", { agentId, discoveryId, error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Discovery details unavailable", code: "DISCOVERY_DETAILS_UNAVAILABLE" },
      { status: 503, headers: PRIVATE_HEADERS });
  }
  if (!snapshot) return NextResponse.json({ error: "Discovery not found" }, { status: 404, headers: PRIVATE_HEADERS });
  return NextResponse.json({
    session: snapshot.session,
    devices: snapshot.devices.map(device => ({
      ...device, observationFingerprint: discoveryObservationFingerprint(device),
    })),
  }, { headers: PRIVATE_HEADERS });
}
