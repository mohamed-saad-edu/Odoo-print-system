import { NextResponse } from "next/server";
import { db } from "../../../../db";
import { tenantSubscriptions, tenants } from "../../../../db/schema";
import { validateWorkspaceManager } from "../../../../lib/manager-auth";
import { eq } from "drizzle-orm";
import { customerSubscriptionState } from "../../../../lib/manual-subscriptions";
import { databaseNowMs } from "../../../../lib/database-clock";

export const dynamic = "force-dynamic";

/** A non-commercial availability probe; account billing data is Platform Owner-only. */
export async function GET(req: Request) {
  const member = await validateWorkspaceManager(req);
  if (!member) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  const [subscription, tenant] = await Promise.all([
    db.query.tenantSubscriptions.findFirst({ where: eq(tenantSubscriptions.tenantId, member.tenantId) }),
    db.query.tenants.findFirst({ where: eq(tenants.id, member.tenantId), columns: { lifecycle: true } }),
  ]);
  const status = customerSubscriptionState(subscription, tenant?.lifecycle, await databaseNowMs());
  return NextResponse.json({
    hasSubscription: status === "active",
    status, customerState: status,
    entitlementBlocked: subscription?.entitlementBlocked ?? false,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
