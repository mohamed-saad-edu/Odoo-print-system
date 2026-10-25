import { parseDbTimeMs } from "./database-timestamp";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, type DbTx } from "../db";
import { plans, subscriptionChanges, subscriptionRequests, tenantSubscriptions } from "../db/schema";
import { nanoid } from "./nanoid";
import { writeAuditEvent } from "./audit";
import { requirePlatformActorInTransaction, type PlatformOwnerClaims } from "./platform-auth";
import { normalizePlanEntitlements } from "./entitlements";

export class ManualSubscriptionError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
export function requestDigest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function requireIdempotencyKey(req: Request): string {
  const key = req.headers.get("idempotency-key") ?? "";
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key)) throw new ManualSubscriptionError("IDEMPOTENCY_KEY_REQUIRED");
  return key;
}
export function customerSubscriptionState(sub: {status: string; currentPeriodStart: Date | string; currentPeriodEnd: Date | string | null; entitlementBlocked?: boolean} | null | undefined, lifecycle = "active", now = Date.now()): "awaiting_activation" | "active" | "expired" | "suspended" {
  if (lifecycle !== "active" || sub?.status === "suspended" || sub?.entitlementBlocked) return "suspended";
  if (!sub || sub.status === "awaiting_activation" || (parseDbTimeMs(sub.currentPeriodStart) ?? Infinity) > now) return "awaiting_activation";
  if (sub.status !== "active" || (sub.currentPeriodEnd && (parseDbTimeMs(sub.currentPeriodEnd) ?? -Infinity) <= now)) return "expired";
  return "active";
}
export async function ensurePendingManualSubscription(tx: DbTx, tenantId: string, planId: string): Promise<void> {
  await tx.insert(tenantSubscriptions).values({tenantId,planId,status:"awaiting_activation",billingMode:"manual",subscriptionType:"paid"}).onConflictDoNothing();
}
export type ManualSubscriptionInput = {
  action: "save" | "renew" | "extend" | "suspend" | "reactivate" | "cancel_at_end" | "revoke";
  expectedRevision: number;
  planId?: string;
  subscriptionType?: "free" | "paid";
  monthlyQuota?: number;
  term?: "monthly" | "yearly" | "custom";
  startDate?: string;
  endDate?: string;
  status?: "active" | "awaiting_activation";
  reason: string;
  internalReference?: string;
  requestId?: string;
};
export function parseManualSubscriptionInput(value: unknown): ManualSubscriptionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ManualSubscriptionError("SUBSCRIPTION_INVALID");
  const b = value as Record<string, unknown>;
  if (!["save","renew","extend","suspend","reactivate","cancel_at_end","revoke"].includes(String(b.action)) || !Number.isSafeInteger(b.expectedRevision) || Number(b.expectedRevision)<0) throw new ManualSubscriptionError("SUBSCRIPTION_INVALID");
  if (typeof b.reason!=="string" || !b.reason.trim() || b.reason.length>500) throw new ManualSubscriptionError("SUBSCRIPTION_REASON_REQUIRED");
  for (const key of ["internalReference","requestId","planId"] as const) if (b[key]!==undefined && (typeof b[key]!=="string" || b[key].length>200)) throw new ManualSubscriptionError("SUBSCRIPTION_INVALID");
  if (["save","renew"].includes(String(b.action))) {
    if (typeof b.planId!=="string" || !["free","paid"].includes(String(b.subscriptionType)) || !["monthly","yearly","custom"].includes(String(b.term)) || !Number.isSafeInteger(b.monthlyQuota) || Number(b.monthlyQuota)<1 || Number(b.monthlyQuota)>2147483647 || !["active","awaiting_activation"].includes(String(b.status))) throw new ManualSubscriptionError("SUBSCRIPTION_INVALID");
    if (typeof b.startDate!=="string" || !Number.isFinite(Date.parse(b.startDate))) throw new ManualSubscriptionError("SUBSCRIPTION_DATES_INVALID");
  }
  if (["save","renew","extend"].includes(String(b.action))) {
    if (typeof b.endDate!=="string" || !Number.isFinite(Date.parse(b.endDate))) throw new ManualSubscriptionError("SUBSCRIPTION_DATES_INVALID");
    if (b.startDate && Date.parse(String(b.endDate))<=Date.parse(String(b.startDate))) throw new ManualSubscriptionError("SUBSCRIPTION_DATES_INVALID");
  }
  return {...b,reason:b.reason.trim()} as ManualSubscriptionInput;
}
function publicSnapshot(row: typeof tenantSubscriptions.$inferSelect | null): Record<string, unknown> | null {
  if (!row) return null;
  return {planId:row.planId,status:row.status,subscriptionType:row.subscriptionType,monthlyQuota:row.monthlyQuota,term:row.term,currentPeriodStart:row.currentPeriodStart.toISOString(),currentPeriodEnd:row.currentPeriodEnd?.toISOString()??null,cancelAtPeriodEnd:row.cancelAtPeriodEnd,internalReference:row.internalReference,revision:row.revision,entitlementBlocked:row.entitlementBlocked,entitlementBlockedReason:row.entitlementBlockedReason};
}
/** Resource -> subscription -> actor lock order matches runtime admission fences. */
export async function mutateManualSubscription(tenantId: string, actor: PlatformOwnerClaims, key: string, input: ManualSubscriptionInput) {
  const digest=requestDigest(input);
  return db.transaction(async tx => {
    const tenant=await tx.execute(sql`SELECT lifecycle FROM tenants WHERE id=${tenantId} FOR UPDATE`);
    if (!tenant.rows.length || tenant.rows[0].lifecycle==='deleted') throw new ManualSubscriptionError("WORKSPACE_NOT_FOUND",404);
    await tx.execute(sql`SELECT tenant_id FROM tenant_subscriptions WHERE tenant_id=${tenantId} FOR UPDATE`);
    await requirePlatformActorInTransaction(tx,actor);
    const previous=await tx.query.subscriptionChanges.findFirst({where:and(eq(subscriptionChanges.tenantId,tenantId),eq(subscriptionChanges.idempotencyKey,key))});
    if (previous) {
      if (previous.requestDigest!==digest || previous.actorId!==actor.userId) throw new ManualSubscriptionError("IDEMPOTENCY_CONFLICT",409);
      return {subscription:previous.after,replayed:true};
    }
    const before=await tx.query.tenantSubscriptions.findFirst({where:eq(tenantSubscriptions.tenantId,tenantId)});
    if ((before?.revision??0)!==input.expectedRevision) throw new ManualSubscriptionError("SUBSCRIPTION_REVISION_CONFLICT",409);
    let changes: Partial<typeof tenantSubscriptions.$inferInsert>={revision:(before?.revision??0)+1};
    if (input.action==='save'||input.action==='renew') {
      const plan=await tx.query.plans.findFirst({where:and(eq(plans.id,input.planId!),eq(plans.isActive,true))});
      if (!plan) throw new ManualSubscriptionError("PLAN_NOT_FOUND",404);
      normalizePlanEntitlements(plan.entitlements);
      const start=new Date(input.startDate!),end=new Date(input.endDate!);
      if (input.action==='renew' && (!before || !before.currentPeriodEnd || end<=before.currentPeriodEnd)) throw new ManualSubscriptionError("SUBSCRIPTION_DATES_INVALID");
      // A renewal extends the same contract and retains original start; it never
      // replaces or resets the independent calendar monthly admission ledger.
      changes={...changes,planId:plan.id,subscriptionType:input.subscriptionType,monthlyQuota:input.monthlyQuota,term:input.term,currentPeriodStart:input.action==='renew'?before!.currentPeriodStart:start,currentPeriodEnd:end,status:input.status,billingMode:'manual',cancelAtPeriodEnd:false,entitlementBlocked:false,entitlementBlockedReason:null,internalReference:input.internalReference||null};
    } else {
      if (!before) throw new ManualSubscriptionError("SUBSCRIPTION_NOT_FOUND",404);
      if (input.action==='extend') {
        const end=new Date(input.endDate!);
        if (end<=before.currentPeriodStart || (before.currentPeriodEnd && end<=before.currentPeriodEnd)) throw new ManualSubscriptionError("SUBSCRIPTION_DATES_INVALID");
        changes.currentPeriodEnd=end;
      }
      if (input.action==='suspend'||input.action==='revoke') changes.status='suspended';
      if (input.action==='reactivate') {
        if (before.status!=='suspended') throw new ManualSubscriptionError('SUBSCRIPTION_REQUEST_CONFLICT',409);
        const now=await tx.execute(sql`SELECT clock_timestamp() AS now`);
        if (before.currentPeriodEnd && before.currentPeriodEnd<=new Date(String(now.rows[0].now))) throw new ManualSubscriptionError("SUBSCRIPTION_EXPIRED",409);
        changes.status='active'; changes.entitlementBlocked=false; changes.entitlementBlockedReason=null;
      }
      if (input.action==='cancel_at_end') {
        if (!before.currentPeriodEnd) throw new ManualSubscriptionError("SUBSCRIPTION_DATES_INVALID");
        changes.cancelAtPeriodEnd=true;
      }
    }
    if (before) await tx.update(tenantSubscriptions).set({...changes,updatedAt:sql`clock_timestamp()`}).where(eq(tenantSubscriptions.tenantId,tenantId));
    else await tx.insert(tenantSubscriptions).values({tenantId,planId:input.planId!,...changes});
    const after=await tx.query.tenantSubscriptions.findFirst({where:eq(tenantSubscriptions.tenantId,tenantId)});
    const snapshot=publicSnapshot(after!)!;
    if (input.requestId) {
      const approved=await tx.update(subscriptionRequests).set({status:'approved',lastActionBy:actor.userId,lastActionAt:sql`clock_timestamp()`,lastActionReason:input.reason,subscriptionRevision:after!.revision}).where(and(eq(subscriptionRequests.id,input.requestId),eq(subscriptionRequests.tenantId,tenantId),eq(subscriptionRequests.status,'pending'))).returning({id:subscriptionRequests.id});
      if (!approved.length || after!.status!=='active') throw new ManualSubscriptionError("SUBSCRIPTION_REQUEST_CONFLICT",409);
    }
    await tx.insert(subscriptionChanges).values({id:`chg_${nanoid(20)}`,tenantId,actorId:actor.userId,action:input.action,idempotencyKey:key,requestDigest:digest,before:publicSnapshot(before??null),after:snapshot,reason:input.reason});
    await writeAuditEvent({tenantId,actorType:'platform',actorId:actor.userId,action:`subscription.${input.action}`,resourceType:'subscription',resourceId:tenantId,metadata:{before:publicSnapshot(before??null),after:snapshot,reason:input.reason}},tx);
    return {subscription:snapshot,replayed:false};
  });
}
