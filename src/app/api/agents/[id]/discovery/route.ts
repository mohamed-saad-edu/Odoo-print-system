import { hasBodyOverLimit } from "../../../../../lib/request-limits";
import { NextResponse } from "next/server";
import { db } from "../../../../../db";
import { agents, discoverySessions } from "../../../../../db/schema";
import { validateWorkspaceManager } from "../../../../../lib/manager-auth";
import { requireManagerPermission } from "../../../../../lib/authorization";
import { requireManagerActorInTransaction, ManagerMutationAuthorityChangedError } from "../../../../../lib/manager-mutation-authorization";
import { requireActiveTenantInTransaction, TenantSuspendedError, TenantDeletedError } from "../../../../../lib/tenant-guard";
import { eq, and, desc, sql } from "drizzle-orm";
import { nanoid } from "../../../../../lib/nanoid";
import { validateDiscoveryRequest } from "../../../../../lib/discovery";
import { logError } from "../../../../../lib/log";
import { expireStaleAgentDiscovery } from "../../../../../lib/discovery-session-expiry";

export const dynamic = "force-dynamic";

// Discovery is runtime infrastructure only. It never receives or creates Odoo business ownership.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (hasBodyOverLimit(req, 64 * 1024)) return NextResponse.json({ error: "Request body too large", code: "INVALID_REQUEST" }, { status: 413 });
  const claims = await validateWorkspaceManager(req);
  if (!claims) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { requireManagerPermission(claims, "agents.pair"); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }
  const { id: agentId } = await params;
  const agent = await db.query.agents.findFirst({ where: and(eq(agents.id, agentId), eq(agents.tenantId, claims.tenantId)) });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (agent.lifecycle !== "active") return NextResponse.json({ error: `Agent is ${agent.lifecycle}` }, { status: 409 });

  let body: unknown;
  try {
    const parsedBody = await req.json(); if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) throw new Error("JSON object required"); body = parsedBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const v = validateDiscoveryRequest(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const discoveryId = `dsc_${nanoid(12)}`;
  try {
    await db.transaction(async (tx) => {
      await requireActiveTenantInTransaction(tx, claims.tenantId);
      // Serialize discovery starts per agent. The database unique partial
      // index remains the final invariant for every writer.
      const locked = await tx.execute(sql`
        SELECT id, lifecycle
        FROM agents
        WHERE id = ${agentId} AND tenant_id = ${claims.tenantId}
        FOR UPDATE
      `);
      const lockedAgent = locked.rows[0] as { id?: string; lifecycle?: string } | undefined;
      if (!lockedAgent?.id) throw new Error("AGENT_NOT_FOUND");
      if (lockedAgent.lifecycle !== "active") throw new Error("AGENT_NOT_ACTIVE");

      // A stale preflight session cannot start a new scan after an admin is
      // demoted or the session family is revoked while the body is in flight.
      // Keep Tenant -> Agent -> Actor -> session ordering until commit.
      await requireManagerActorInTransaction(tx, claims, "agents.pair");

      // Reclaim an abandoned scan before enforcing the one-active-session
      // invariant. The update is conditional and serializes with Agent report
      // commits, so an actively uploading Agent cannot lose its claim.
      await expireStaleAgentDiscovery((query) => tx.execute(query), claims.tenantId, agentId);
      const active = await tx.query.discoverySessions.findFirst({
        where: and(
          eq(discoverySessions.agentId, agentId),
          eq(discoverySessions.tenantId, claims.tenantId),
          eq(discoverySessions.status, "running"),
        ),
      });
      if (active) throw new Error("DISCOVERY_ALREADY_RUNNING");

      await tx.insert(discoverySessions).values({
        id: discoveryId,
        tenantId: claims.tenantId,
        agentId,
        status: "running",
        config: v.data,
        stats: {},
        startedAt: sql`now()`,
      });
      // Push discovery instantly via Postgres NOTIFY -> WebSocket (10-50ms)
      // instead of waiting for agent's 10s poll fallback. Matches job delivery path.
      await tx.execute(sql`SELECT pg_notify('print_gateway_discovery', ${JSON.stringify({ agentId, discoveryId })}::text)`);
    });
  } catch (error) {
    if (error instanceof ManagerMutationAuthorityChangedError) return error.response();
    if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof Error && error.message === "AGENT_NOT_FOUND") {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    if (error instanceof Error && error.message === "AGENT_NOT_ACTIVE") {
      return NextResponse.json({ error: "Agent is not active" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "DISCOVERY_ALREADY_RUNNING") {
      return NextResponse.json({ error: "Discovery already running for this agent" }, { status: 409 });
    }
    if ((error as { code?: string })?.code === "23505") {
      return NextResponse.json({ error: "Discovery already running for this agent" }, { status: 409 });
    }
    logError("agent.discovery.failed", { agentId, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  return NextResponse.json({ discoveryId, agentId, status: "running" }, { status: 201 });
}

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await validateWorkspaceManager(req);
  if (!claims) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  try { requireManagerPermission(claims, "agents.read"); } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const { id: agentId } = await params;
  let result;
  try {
    result = await db.transaction(async tx => {
      await requireActiveTenantInTransaction(tx, claims.tenantId);
      // Read-time authority must agree with the current workspace session.
      // Take the Agent lock before the actor lock, matching discovery POST's
      // Tenant -> Agent -> Actor order and avoiding conflicting scan starts.
      const locked = await tx.execute(sql`SELECT id FROM agents
        WHERE id = ${agentId} AND tenant_id = ${claims.tenantId} FOR SHARE`);
      if (!locked.rows.length) return null;
      await requireManagerActorInTransaction(tx, claims, "agents.read");
      // Expiry is a write: it must not mutate another Agent's session after
      // the requesting manager was revoked or the tenant was suspended.
      await expireStaleAgentDiscovery(query => tx.execute(query), claims.tenantId, agentId);
      return tx.query.discoverySessions.findMany({
        where: and(eq(discoverySessions.agentId, agentId), eq(discoverySessions.tenantId, claims.tenantId)),
        orderBy: [desc(discoverySessions.createdAt)], limit: 20,
      });
    });
  } catch (error) {
    if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError)
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: PRIVATE_HEADERS });
    if (error instanceof ManagerMutationAuthorityChangedError) return error.response();
    logError("agent.discovery_read_failed", { agentId, error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Discovery history unavailable", code: "DISCOVERY_HISTORY_UNAVAILABLE" },
      { status: 503, headers: PRIVATE_HEADERS });
  }
  if (!result) return NextResponse.json({ error: "Agent not found" }, { status: 404, headers: PRIVATE_HEADERS });
  return NextResponse.json(result, { headers: PRIVATE_HEADERS });
}
