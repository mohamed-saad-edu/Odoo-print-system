import { hasManagerPermission } from "../../../../lib/authorization";
import { NextResponse } from "next/server";
import { db } from "../../../../db";
import { plans, tenantSubscriptions, tenants } from "../../../../db/schema";
import { validateWorkspaceManager } from "../../../../lib/manager-auth";
import { eq } from "drizzle-orm";
import { customerSubscriptionState } from "../../../../lib/manual-subscriptions";
import { databaseNowMs } from "../../../../lib/database-clock";
export const dynamic = "force-dynamic";
export async function GET(req:Request) {
  const manager=await validateWorkspaceManager(req);
  if(!manager)return NextResponse.json({error:'Unauthorized',code:'UNAUTHORIZED'},{status:401});
  const [sub,tenant]=await Promise.all([
    db.query.tenantSubscriptions.findFirst({where:eq(tenantSubscriptions.tenantId,manager.tenantId)}),
    db.query.tenants.findFirst({where:eq(tenants.id,manager.tenantId),columns:{lifecycle:true}}),
  ]);
  const customerState=customerSubscriptionState(sub,tenant?.lifecycle,await databaseNowMs());
  const includePlanName = new URL(req.url).searchParams.get("includePlanName") === "1";
  const plan=includePlanName && customerState==='active' && hasManagerPermission(manager,"billing.read") && sub?await db.query.plans.findFirst({where:eq(plans.id,sub.planId),columns:{name:true}}):null;
  return NextResponse.json({hasSubscription:customerState==='active',status:customerState,customerState,entitlementBlocked:sub?.entitlementBlocked??false,planId:sub?.planId??null,planName:plan?.name??null,currentPeriodStart:sub?.currentPeriodStart??null,currentPeriodEnd:sub?.currentPeriodEnd??null,subscriptionType:sub?.subscriptionType??null,term:sub?.term??null,cancelAtPeriodEnd:sub?.cancelAtPeriodEnd??false},{headers:{'Cache-Control':'no-store'}});
}
