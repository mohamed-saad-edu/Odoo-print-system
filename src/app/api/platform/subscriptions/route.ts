import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "../../../../db";
import { requirePlatformOwner } from "../../../../lib/platform-auth";
import { manualApiError } from "../../../../lib/manual-api-error";
import { quotaCycleStartSql } from "../../../../lib/quota-cycle";
import { effectiveSubscriptionStatusSql } from "../../../../lib/effective-subscription-status";
import { parseStrictListLimit, parseStrictListOffset } from "../../../../lib/request-limits";
const HEADERS = { "Cache-Control": "private, no-store" };
export async function GET(req:Request) {
 try {
  await requirePlatformOwner(req);const params=new URL(req.url).searchParams;
  const limit=parseStrictListLimit(params.get("limit"),300,300);
  const offset=parseStrictListOffset(params.get("offset"),1_000_000);
  if(limit===null||offset===null)return NextResponse.json({error:"Invalid pagination",code:"INVALID_PAGINATION"},{status:400,headers:HEADERS});
  const status=params.get("status")??"all";
  if(!["all","active","awaiting_activation","expired","suspended"].includes(status))return NextResponse.json({error:"Invalid subscription filter",code:"INVALID_FILTER"},{status:400,headers:HEADERS});
  const search=(params.get('search')??'').trim(),term=`%${search.replace(/[%_\\]/g,'\\$&')}%`;
  if(search.length>200)return NextResponse.json({error:"Search too long",code:"INVALID_SEARCH"},{status:400,headers:HEADERS});
  const statusSql=effectiveSubscriptionStatusSql({tenantId:sql`t.id`,tenantLifecycle:sql`t.lifecycle`,subscriptionStatus:sql`s.status`,entitlementBlocked:sql`s.entitlement_blocked`,currentPeriodStart:sql`s.current_period_start`});
  const rows=await db.execute(sql`SELECT t.id AS "tenantId",t.name AS "tenantName",t.lifecycle AS "tenantLifecycle",p.name AS "planName",s.plan_id AS "planId",${statusSql} AS status,s.subscription_type AS "subscriptionType",s.monthly_quota AS "monthlyQuota",s.current_period_end AS "currentPeriodEnd",s.term,s.cancel_at_period_end AS "cancelAtPeriodEnd",coalesce(m.used_prints,0) AS used FROM tenant_subscriptions s JOIN tenants t ON t.id=s.tenant_id JOIN plans p ON p.id=s.plan_id LEFT JOIN print_monthly_usage m ON m.tenant_id=t.id AND m.period_start=${quotaCycleStartSql()} WHERE (t.name ILIKE ${term} OR t.id ILIKE ${term}) AND (${status} = 'all' OR ${statusSql} = ${status}) ORDER BY t.created_at DESC,t.id DESC LIMIT ${limit + 1} OFFSET ${offset}`);
  return NextResponse.json({subscriptions:rows.rows.slice(0,limit),hasMore:rows.rows.length>limit,limit,offset},{headers:HEADERS});
 }catch(e){const response=manualApiError(e);response.headers.set("Cache-Control","private, no-store");return response;}
}
