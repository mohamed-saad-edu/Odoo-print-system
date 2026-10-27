import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "../../../../db";
import { requirePlatformOwner } from "../../../../lib/platform-auth";
import { manualApiError } from "../../../../lib/manual-api-error";
import { quotaCycleStartSql } from "../../../../lib/quota-cycle";
import { effectiveSubscriptionStatusSql } from "../../../../lib/effective-subscription-status";
export async function GET(req:Request) {
 try {
  await requirePlatformOwner(req);const params=new URL(req.url).searchParams;
  const search=(params.get('search')??'').slice(0,200),term=`%${search.replace(/[%_\\]/g,'\\$&')}%`;
  const rows=await db.execute(sql`SELECT t.id AS "tenantId",t.name AS "tenantName",t.lifecycle AS "tenantLifecycle",p.name AS "planName",s.plan_id AS "planId",${effectiveSubscriptionStatusSql({tenantId:sql`t.id`,tenantLifecycle:sql`t.lifecycle`,subscriptionStatus:sql`s.status`,entitlementBlocked:sql`s.entitlement_blocked`,currentPeriodStart:sql`s.current_period_start`})} AS status,s.subscription_type AS "subscriptionType",s.monthly_quota AS "monthlyQuota",s.current_period_end AS "currentPeriodEnd",s.term,s.cancel_at_period_end AS "cancelAtPeriodEnd",coalesce(m.used_prints,0) AS used FROM tenant_subscriptions s JOIN tenants t ON t.id=s.tenant_id JOIN plans p ON p.id=s.plan_id LEFT JOIN print_monthly_usage m ON m.tenant_id=t.id AND m.period_start=${quotaCycleStartSql()} WHERE (t.name ILIKE ${term} OR t.id ILIKE ${term}) ORDER BY t.created_at DESC LIMIT 300`);
  return NextResponse.json({subscriptions:rows.rows},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return manualApiError(e);}
}
