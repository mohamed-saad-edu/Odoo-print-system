import { assertWorkspaceSecurityOrigin,readWorkspaceSecurityJson } from "../../../../../lib/workspace-session-http";
import { NextResponse } from "next/server";
import { eq,sql } from "drizzle-orm";
import { db } from "../../../../../db";
import { plans } from "../../../../../db/schema";
import { requirePlatformOwner,requirePlatformActorInTransaction } from "../../../../../lib/platform-auth";
import { manualApiError } from "../../../../../lib/manual-api-error";
import { parseManualPlan } from "../../../../../lib/manual-plans";
import { ManualSubscriptionError,requireIdempotencyKey,requestDigest } from "../../../../../lib/manual-subscriptions";
import { writeAuditEvent } from "../../../../../lib/audit";
export async function PATCH(req:Request,context:{params:Promise<{id:string}>}) {
 try {
    assertWorkspaceSecurityOrigin(req);
  const actor=await requirePlatformOwner(req),key=requireIdempotencyKey(req),{id}=await context.params;
  const raw=await readWorkspaceSecurityJson(req) as Record<string,unknown>;
  const plan=parseManualPlan({...raw,id}),digest=requestDigest(plan);
  await db.transaction(async tx=>{
   await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'manual-plan:'+id},0))`);
   await tx.execute(sql`SELECT id FROM plans WHERE id=${id} FOR UPDATE`);
   await requirePlatformActorInTransaction(tx,actor);
   const previous=await tx.execute(sql`SELECT metadata FROM audit_events WHERE actor_type='platform' AND actor_id=${actor.userId} AND action='plan.updated' AND request_id=${key} LIMIT 1`);
   if(previous.rows.length){if((previous.rows[0].metadata as {digest?:string}).digest!==digest)throw new ManualSubscriptionError('IDEMPOTENCY_CONFLICT',409);return;}
   const before=await tx.query.plans.findFirst({where:eq(plans.id,id)});
   if(!before)throw new ManualSubscriptionError('PLAN_NOT_FOUND',404);
   // Per-workspace quotas are explicit and remain unchanged. Preserve technical
   // safety policy on catalog edits instead of exposing it as commercial pricing.
   const entitlements={...before.entitlements,max_agents:'unlimited',max_printers:'unlimited',max_prints_per_period:plan.entitlements.max_prints_per_period};
   await tx.update(plans).set({...plan,entitlements,updatedAt:sql`clock_timestamp()`}).where(eq(plans.id,id));
   await writeAuditEvent({tenantId:null,actorType:'platform',actorId:actor.userId,action:'plan.updated',resourceType:'plan',resourceId:id,requestId:key,metadata:{before:{name:before.name,entitlements:before.entitlements,isActive:before.isActive,isPublic:before.isPublic},after:{...plan,entitlements},digest}},tx);
  });return NextResponse.json({ok:true});
 }catch(e){return manualApiError(e);}
}
