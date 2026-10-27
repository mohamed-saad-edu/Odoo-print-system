import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "../../../../db";
import { requirePlatformOwner } from "../../../../lib/platform-auth";
import { manualApiError } from "../../../../lib/manual-api-error";
import { quotaCycleStartSql } from "../../../../lib/quota-cycle";
export async function GET(req:Request) {
 try {
  await requirePlatformOwner(req);const params=new URL(req.url).searchParams;
  const search=(params.get('search')??'').slice(0,200),term=`%${search.replace(/[%_\\]/g,'\\$&')}%`;
  const rows=await db.execute(sql`SELECT t.id AS "tenantId",t.name AS "tenantName",t.lifecycle AS "tenantLifecycle",p.name AS "planName",s.plan_id AS "planId",CASE WHEN t.lifecycle<>'active' OR s.status='suspended' OR s.entitlement_blocked THEN 'suspended' WHEN s.status='active' AND s.current_period_start<=clock_timestamp() AND (s.current_period_end IS NULL OR s.current_period_end>clock_timestamp()) THEN 'active' WHEN s.status='awaiting_activation' OR s.current_period_start>clock_timestamp() THEN 'awaiting_activation' ELSE 'expired' END AS status,s.subscription_type AS "subscriptionType",s.monthly_quota AS "monthlyQuota",s.current_period_end AS "currentPeriodEnd",s.term,s.cancel_at_period_end AS "cancelAtPeriodEnd",coalesce(m.used_prints,0) AS used FROM tenant_subscriptions s JOIN tenants t ON t.id=s.tenant_id JOIN plans p ON p.id=s.plan_id LEFT JOIN print_monthly_usage m ON m.tenant_id=t.id AND m.period_start=${quotaCycleStartSql(sql`COALESCE(s.print_cycle_anchor,s.current_period_start)`)} WHERE (t.name ILIKE ${term} OR t.id ILIKE ${term}) ORDER BY t.created_at DESC LIMIT 300`);
  return NextResponse.json({subscriptions:rows.rows},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return manualApiError(e);}
}
