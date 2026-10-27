import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "../../../../../db";
import { requirePlatformOwner } from "../../../../../lib/platform-auth";
import { manualApiError } from "../../../../../lib/manual-api-error";
import { databaseNowMs } from "../../../../../lib/database-clock";
import { customerSubscriptionState,ManualSubscriptionError } from "../../../../../lib/manual-subscriptions";
import { logicalUsageReport } from "../../../../../lib/manual-usage-report";
import { quotaCycleStartSql, quotaCycleEndSql } from "../../../../../lib/quota-cycle";
export async function GET(req:Request,context:{params:Promise<{id:string}>}) {
 try {
  await requirePlatformOwner(req);const {id}=await context.params;
  const workspace=await db.execute(sql`SELECT t.*,u.id AS "ownerId",u.display_name AS "ownerName",u.email AS "ownerEmail",u.email_verified_at AS "ownerVerifiedAt" FROM tenants t LEFT JOIN tenant_users tu ON tu.tenant_id=t.id AND tu.role='owner' LEFT JOIN users u ON u.id=tu.user_id WHERE t.id=${id}`);
  if(!workspace.rows.length)throw new ManualSubscriptionError('WORKSPACE_NOT_FOUND',404);
  const [subscription,members,agents,printers,installations,credentials,jobs,events,history,requests,usage]=await Promise.all([
   db.execute(sql`SELECT s.tenant_id AS "tenantId",s.plan_id AS "planId",p.name AS "planName",s.status,s.entitlement_blocked AS "entitlementBlocked",s.subscription_type AS "subscriptionType",coalesce(s.monthly_quota,CASE WHEN p.entitlements->>'max_prints_per_period' ~ '^[0-9]{1,9}$' THEN (p.entitlements->>'max_prints_per_period')::int ELSE NULL END) AS "monthlyQuota",s.term,s.current_period_start AS "currentPeriodStart",s.current_period_end AS "currentPeriodEnd",s.cancel_at_period_end AS "cancelAtPeriodEnd",s.internal_reference AS "internalReference",s.revision,coalesce(m.used_prints,0) AS "monthlyUsed",(${quotaCycleEndSql()}) AT TIME ZONE 'UTC' AS "nextReset" FROM tenant_subscriptions s JOIN plans p ON p.id=s.plan_id LEFT JOIN print_monthly_usage m ON m.tenant_id=s.tenant_id AND m.period_start=${quotaCycleStartSql()} WHERE s.tenant_id=${id}`),
   db.execute(sql`SELECT u.id,u.display_name AS name,u.email,u.email_verified_at AS "verifiedAt",tu.role,(u.is_platform_owner AND u.email_verified_at IS NOT NULL) AS "isPlatformOwner" FROM tenant_users tu JOIN users u ON u.id=tu.user_id WHERE tu.tenant_id=${id} ORDER BY tu.created_at LIMIT 300`),
   db.execute(sql`SELECT id,name,status,lifecycle,last_seen_at AS "lastSeenAt" FROM agents WHERE tenant_id=${id} ORDER BY created_at DESC LIMIT 300`),
   db.execute(sql`SELECT id,name,status,lifecycle,verification_state AS "verificationState",inventory_present AS "inventoryPresent",last_seen_at AS "lastSeenAt",agent_id AS "agentId" FROM printers WHERE tenant_id=${id} ORDER BY created_at DESC LIMIT 300`),
   db.execute(sql`SELECT id,enabled,created_at AS "createdAt" FROM odoo_installations WHERE tenant_id=${id} ORDER BY created_at DESC LIMIT 300`),
   db.execute(sql`SELECT id,name,created_at AS "createdAt",revoked_at AS "revokedAt",last_used_at AS "lastUsedAt" FROM api_keys WHERE tenant_id=${id} ORDER BY created_at DESC LIMIT 300`),
   db.execute(sql`SELECT id,status,created_at AS "createdAt" FROM print_jobs WHERE tenant_id=${id} ORDER BY created_at DESC LIMIT 50`),
   db.execute(sql`SELECT id,actor_id AS "actorId",action,created_at AS "createdAt" FROM audit_events WHERE tenant_id=${id} ORDER BY created_at DESC LIMIT 50`),
   db.execute(sql`SELECT c.id,c.action,c.actor_id AS "actorId",u.email AS "actorEmail",c."before",c."after",c.reason,c.created_at AS "createdAt" FROM subscription_changes c LEFT JOIN users u ON u.id=c.actor_id WHERE c.tenant_id=${id} ORDER BY c.created_at DESC LIMIT 100`),
   db.execute(sql`SELECT id,status,requester_user_id AS "requesterUserId",requester_name AS "requesterName",requester_email AS "requesterEmail",requester_verified_at AS "requesterVerifiedAt",plan_id AS "planId",term,requested_monthly_quota AS "requestedMonthlyQuota",approved_plan_id AS "approvedPlanId",approved_term AS "approvedTerm",approved_monthly_quota AS "approvedMonthlyQuota",approval_modified AS "approvalModified",created_at AS "createdAt",last_action_at AS "lastActionAt",last_action_reason AS "lastActionReason",subscription_revision AS "subscriptionRevision" FROM subscription_requests WHERE tenant_id=${id} ORDER BY created_at DESC LIMIT 100`),
   logicalUsageReport(id),
  ]);
  const stored=subscription.rows[0] as {status:string;billingMode:string;currentPeriodStart:string;currentPeriodEnd:string|null;entitlementBlocked:boolean}|undefined;
  const effectiveStatus=customerSubscriptionState(stored,String(workspace.rows[0].lifecycle),await databaseNowMs());
  return NextResponse.json({workspace:workspace.rows[0],subscription:stored?{...stored,effectiveStatus}:null,members:members.rows,agents:agents.rows,printers:printers.rows,installations:installations.rows,credentials:credentials.rows,jobs:jobs.rows,events:events.rows,history:history.rows,requests:requests.rows,usage},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return manualApiError(e);}
}
