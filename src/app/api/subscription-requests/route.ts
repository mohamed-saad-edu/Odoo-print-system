import { assertWorkspaceSecurityOrigin,readWorkspaceSecurityJson } from "../../../lib/workspace-session-http";
import { NextResponse } from "next/server";
import { and,desc,eq,sql } from "drizzle-orm";
import { db } from "../../../db";
import { plans,subscriptionRequests,tenantSubscriptions,tenants,users } from "../../../db/schema";
import { validateWorkspaceManager } from "../../../lib/manager-auth";
import { hasManagerPermission } from "../../../lib/authorization";
import { requireManagerActorInTransaction } from "../../../lib/manager-mutation-authorization";
import { requireActiveTenantInTransaction } from "../../../lib/tenant-guard";
import { customerSubscriptionState,ensurePendingManualSubscription,ManualSubscriptionError,requestDigest,requireIdempotencyKey } from "../../../lib/manual-subscriptions";
import { manualApiError } from "../../../lib/manual-api-error";
import { writeAuditEvent } from "../../../lib/audit";
import { nanoid } from "../../../lib/nanoid";
import { activationWhatsAppUrl } from "../../../lib/activation-contact";
import { databaseNowMs } from "../../../lib/database-clock";
const safeRequest=(r:typeof subscriptionRequests.$inferSelect)=>({id:r.id,reference:r.id,status:r.status,createdAt:r.createdAt,planId:r.planId,term:r.term,requestedMonthlyQuota:r.requestedMonthlyQuota,whatsappUrl:activationWhatsAppUrl(r.id)});
export async function GET(req:Request) {
  try {
    const actor=await validateWorkspaceManager(req);
    if (!actor) throw new ManualSubscriptionError("UNAUTHORIZED",401);
    if (!actor.userId || !hasManagerPermission(actor, "billing.read")) throw new ManualSubscriptionError("OWNER_REQUIRED",403);
    const [subscription,tenant,requests]=await Promise.all([
      db.query.tenantSubscriptions.findFirst({where:eq(tenantSubscriptions.tenantId,actor.tenantId)}),
      db.query.tenants.findFirst({where:eq(tenants.id,actor.tenantId)}),
      actor.role==='owner'?db.query.subscriptionRequests.findMany({where:eq(subscriptionRequests.tenantId,actor.tenantId),orderBy:desc(subscriptionRequests.createdAt),limit:50}):Promise.resolve([]),
    ]);
    const status=customerSubscriptionState(subscription,tenant?.lifecycle,await databaseNowMs());
    return NextResponse.json({requests:requests.map(safeRequest),status,hasSubscription:status==='active',planId:subscription?.planId??null,currentPeriodStart:subscription?.currentPeriodStart??null,currentPeriodEnd:subscription?.currentPeriodEnd??null},{headers:{"Cache-Control":"no-store"}});
  } catch(error) {return manualApiError(error);}
}
export async function POST(req:Request) {
  try {
    assertWorkspaceSecurityOrigin(req);
    const actor=await validateWorkspaceManager(req);
    if (!actor?.userId || actor.role!=='owner') throw new ManualSubscriptionError("OWNER_REQUIRED",403);
    const b=await readWorkspaceSecurityJson(req) as Record<string,unknown>;
    if (!b || typeof b.planId!=='string' || b.planId.length>100 || !['monthly','yearly','custom'].includes(String(b.term)) || (b.requestedMonthlyQuota!==undefined && (!Number.isSafeInteger(b.requestedMonthlyQuota)||Number(b.requestedMonthlyQuota)<1||Number(b.requestedMonthlyQuota)>2147483647))) throw new ManualSubscriptionError("SUBSCRIPTION_INVALID");
    const input={planId:b.planId,term:String(b.term),requestedMonthlyQuota:b.requestedMonthlyQuota===undefined?null:Number(b.requestedMonthlyQuota)},key=requireIdempotencyKey(req),digest=requestDigest(input);
    const result=await db.transaction(async tx=>{
      await tx.execute(sql`SELECT id FROM tenants WHERE id=${actor.tenantId} FOR UPDATE`);
      await requireActiveTenantInTransaction(tx,actor.tenantId);
      await requireManagerActorInTransaction(tx,actor,"billing.read");
      const user=await tx.query.users.findFirst({where:eq(users.id,actor.userId!)});
      if (!user?.emailVerifiedAt) throw new ManualSubscriptionError("VERIFIED_OWNER_REQUIRED",403);
      const replay=await tx.query.subscriptionRequests.findFirst({where:and(eq(subscriptionRequests.tenantId,actor.tenantId),eq(subscriptionRequests.idempotencyKey,key))});
      if (replay) {
        if(replay.requestDigest!==digest||replay.requesterUserId!==actor.userId) throw new ManualSubscriptionError("IDEMPOTENCY_CONFLICT",409);
        return {request:safeRequest(replay),replayed:true};
      }
      const pending=await tx.query.subscriptionRequests.findFirst({where:and(eq(subscriptionRequests.tenantId,actor.tenantId),eq(subscriptionRequests.status,'pending'))});
      if (pending) {
        // Do not acknowledge a different plan or term as a successful request.
        if (pending.requestDigest !== digest) {
          throw new ManualSubscriptionError("SUBSCRIPTION_REQUEST_ALREADY_PENDING",409);
        }
        return {request:safeRequest(pending),replayed:true};
      }
      const plan=await tx.query.plans.findFirst({where:and(eq(plans.id,input.planId),eq(plans.isActive,true),eq(plans.isPublic,true))});
      if (!plan) throw new ManualSubscriptionError("PLAN_NOT_FOUND",404);
      // Capture the plan's promised allowance when the request is submitted;
      // later catalog edits cannot silently rewrite what the customer asked for.
      const allowance=plan.entitlements.max_prints_per_period;
      const requestedMonthlyQuota=input.requestedMonthlyQuota ??
        (typeof allowance==="number" && Number.isSafeInteger(allowance) && allowance>0 ? allowance : null);
      await ensurePendingManualSubscription(tx,actor.tenantId,plan.id);
      const [request]=await tx.insert(subscriptionRequests).values({id:`req_${nanoid(24)}`,tenantId:actor.tenantId,requesterUserId:user.id,requesterName:user.displayName??'',requesterEmail:user.email,requesterVerifiedAt:user.emailVerifiedAt,...input,requestedMonthlyQuota,idempotencyKey:key,requestDigest:digest}).returning();
      await writeAuditEvent({tenantId:actor.tenantId,actorType:'user',actorId:user.id,action:'subscription.requested',resourceType:'subscription_request',resourceId:request.id,metadata:input},tx);
      return {request:safeRequest(request),replayed:false};
    });
    return NextResponse.json({...result,whatsappUrl:result.request.whatsappUrl},{status:result.replayed?200:201});
  } catch(error) {return manualApiError(error);}
}
