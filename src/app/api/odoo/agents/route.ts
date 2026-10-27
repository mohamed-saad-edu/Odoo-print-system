import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { agents } from "../../../../db/schema";
import { validateOdooKey } from "../../../../lib/odoo-auth";
import { getAgentHeartbeatFreshness, getEffectiveAgentStatus } from "../../../../lib/agent-availability";
import { gatewayNow, refreshClockSkew } from "../../../../lib/database-clock";
import { TenantSubscriptionRequiredError, requireTenantBillingAccess } from "../../../../lib/entitlements";
import { requireActiveTenantInTransaction, TenantSuspendedError, TenantDeletedError } from "../../../../lib/tenant-guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const apiKey = await validateOdooKey(req, { requireIntegrationEnabled: false });
  if (!apiKey) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Agent discovery is part of the runtime control plane and must use the
  // exact same database-authoritative billing predicate as pairing, printing,
  // and resource admission. This intentionally keeps past_due tenants usable
  // during Stripe recovery even after the nominal period end.
  //
  // The billing decision and the inventory read run in ONE transaction, so a
  // subscription that lapses between them cannot still expose tenant runtime
  // inventory. The subscription row lock the check takes is held until the
  // read completes, and the webhook that revokes access waits for it.
  let rows: Array<{
    id: string;
    name: string;
    status: string | null;
    lifecycle: string;
    lastSeenAt: Date | null;
  }>;
  try {
    rows = await db.transaction(async (tx) => {
      // Authentication is outside this transaction. Fence a concurrent tenant
      // suspension before touching subscription and inventory (lock order).
      await requireActiveTenantInTransaction(tx, apiKey.tenantId);
      await requireTenantBillingAccess(tx, apiKey.tenantId);
      return tx
        .select({
          id: agents.id,
          name: agents.name,
          status: agents.status,
          lifecycle: agents.lifecycle,
          lastSeenAt: agents.lastSeenAt,
        })
        .from(agents)
        .where(and(eq(agents.lifecycle, "active"), eq(agents.tenantId, apiKey.tenantId)))
        .orderBy(asc(agents.name));
    });
  } catch (error) {
    if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof TenantSubscriptionRequiredError) {
      return NextResponse.json(
        { error: error.message, code: "SUBSCRIPTION_REQUIRED" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }

  // Agent heartbeat timestamps are still rendered using the calibrated Gateway
  // clock because availability is a host-side presentation calculation.
  await refreshClockSkew();

  const now = gatewayNow();
  const sanitized = rows.map((agent) => ({
    id: agent.id,
    name: agent.name,
    // Current presentation state is evidence-based: stale/missing heartbeat
    // becomes unknown, while the last Agent-reported value remains available
    // separately for diagnostics.
    status: getEffectiveAgentStatus(agent, now),
    reportedStatus: agent.status,
    freshness: getAgentHeartbeatFreshness(agent.lastSeenAt, now),
    lifecycle: agent.lifecycle,
    lastSeenAt: agent.lastSeenAt,
  }));

  return NextResponse.json({ agents: sanitized }, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
