import { NextResponse } from "next/server";
import { db } from "../../../../db";
import { plans, tenantSubscriptions } from "../../../../db/schema";
import { getTenantEntitlements, getTenantPrintUsage, isTenantBillingError } from "../../../../lib/entitlements";
import { validateWorkspaceManager } from "../../../../lib/manager-auth";
import { requireManagerPermission } from "../../../../lib/authorization";
import { requireActiveTenantInTransaction, TenantSuspendedError, TenantDeletedError } from "../../../../lib/tenant-guard";
import { requireManagerActorInTransaction, ManagerMutationAuthorityChangedError } from "../../../../lib/manager-mutation-authorization";
import { eq, sql } from "drizzle-orm";
import { logError } from "../../../../lib/log";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  const manager = await validateWorkspaceManager(req);
  if (!manager) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });
  try { requireManagerPermission(manager, "billing.read"); }
  catch { return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403, headers: PRIVATE_HEADERS }); }

  try {
    // The owner role, session, subscription and monthly usage must still be
    // valid at the database read, not merely when the HTTP cookie was checked.
    // Hold lifecycle/session locks until all tenant-scoped counters are read.
    const { subscription, plan, entitlements, printUsage, counts } = await db.transaction(async tx => {
      await requireActiveTenantInTransaction(tx, manager.tenantId);
      await requireManagerActorInTransaction(tx, manager, "billing.read");
      const subscription = await tx.query.tenantSubscriptions.findFirst({
        where: eq(tenantSubscriptions.tenantId, manager.tenantId),
        columns: { planId: true },
      });
      if (!subscription) return { subscription: null, plan: null, entitlements: null, printUsage: null, counts: null };
      const plan = await tx.query.plans.findFirst({
        where: eq(plans.id, subscription.planId),
        columns: { id: true, name: true, entitlements: true },
      });
      if (!plan) return { subscription, plan: null, entitlements: null, printUsage: null, counts: null };
      const entitlements = await getTenantEntitlements(tx, manager.tenantId);
      const printUsage = await getTenantPrintUsage(tx, manager.tenantId);
      const counts = await tx.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM agents WHERE tenant_id = ${manager.tenantId} AND lifecycle <> 'retired') AS "agents",
          (SELECT COUNT(*)::int FROM printers WHERE tenant_id = ${manager.tenantId} AND shared_with_gateway = true AND lifecycle <> 'retired' AND (management_source <> 'agent' OR inventory_present = true)) AS "printers"
      `);
      return { subscription, plan, entitlements, printUsage, counts };
    });
    if (!subscription) return NextResponse.json({ error: "An active subscription is required", code: "TENANT_SUBSCRIPTION_REQUIRED" }, { status: 403, headers: PRIVATE_HEADERS });
    if (!plan || !entitlements || !printUsage || !counts) return NextResponse.json({ error: "Plan configuration is unavailable", code: "TENANT_ENTITLEMENT_UNAVAILABLE" }, { status: 403, headers: PRIVATE_HEADERS });
    const row = counts.rows[0] as { agents?: number | string; printers?: number | string } | undefined;

    return NextResponse.json({
      plan: { id: plan.id, name: plan.name },
      resources: {
        agents: { used: Number(row?.agents ?? 0), limit: entitlements.max_agents },
        printers: { used: Number(row?.printers ?? 0), limit: entitlements.max_printers },
        prints: {
          unit: "job",
          used: printUsage.used,
          limit: printUsage.limit,
          remaining: printUsage.remaining,
          periodStart: printUsage.periodStart.toISOString(),
          periodEnd: printUsage.periodEnd?.toISOString() ?? null,
        },
      },
    }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403, headers: PRIVATE_HEADERS });
    }
    if (error instanceof ManagerMutationAuthorityChangedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: PRIVATE_HEADERS });
    }
    if (isTenantBillingError(error)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403, headers: PRIVATE_HEADERS });
    }
    logError("billing.owner_usage_read_failed", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Usage information is temporarily unavailable", code: "USAGE_UNAVAILABLE" },
      { status: 503, headers: PRIVATE_HEADERS });
  }
}
