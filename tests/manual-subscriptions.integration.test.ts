import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq,sql } from "drizzle-orm";
import { db } from "../src/db";
import { users,tenants,tenantUsers,plans,tenantSubscriptions,subscriptionRequests } from "../src/db/schema";
import { applyMigrations,closePool,hasTestDatabase,pool,seedFixture,truncateAll } from "./helpers/pg";
import { createVerifiedPlatformSession } from "./helpers/platform-session";
import { issueWorkspaceTestSession } from "./helpers/workspace-session";
import { sessionCookieName } from "../src/lib/session-config";
import { verifyPlatformTokenSignature } from "../src/lib/platform-auth";
import { mutateManualSubscription,ensurePendingManualSubscription,parseManualSubscriptionInput } from "../src/lib/manual-subscriptions";
import { getTenantPrintUsage,getTenantEntitlements,getTenantEntitlementLimit,requireTenantBillingAccess,reserveTenantPrintCredit,TenantPrintQuotaExceededError,TenantSubscriptionRequiredError } from "../src/lib/entitlements";
import { POST as requestActivation,GET as requestsGET } from "../src/app/api/subscription-requests/route";
import { POST as subscriptionPOST } from "../src/app/api/platform/tenants/[id]/subscription/route";
import { GET as workspaceGET } from "../src/app/api/platform/tenants/[id]/route";
import { GET as billingStatusGET } from "../src/app/api/billing/status/route";
import { GET as platformSubscriptionsGET } from "../src/app/api/platform/subscriptions/route";
import { POST as rejectRequest, GET as listPlatformRequests } from "../src/app/api/platform/subscription-requests/route";
import { PATCH as editPlan } from "../src/app/api/platform/plans/[id]/route";
import { POST as createPlan,GET as listAdminPlans } from "../src/app/api/platform/plans/route";
import { GET as publicPlansGET } from "../src/app/api/billing/plans/route";
import { POST as suspendWorkspace } from "../src/app/api/platform/tenants/[id]/suspend/route";
import { POST as reactivateWorkspace } from "../src/app/api/platform/tenants/[id]/reactivate/route";
import { GET as statsGET } from "../src/app/api/platform/stats/route";
import { POST as webhookPOST } from "../src/app/api/billing/webhook/route";
import { POST as checkoutPOST } from "../src/app/api/billing/checkout/route";
import { createPrintJobForPrinter } from "../src/lib/print-job-service";
import { logicalUsageReport } from "../src/lib/manual-usage-report";
const suite=describe.skipIf(!hasTestDatabase);
const origin='https://manual.test';
const entitlements={max_agents:1,max_printers:1,max_jobs_per_minute:120,max_concurrent_jobs:100,max_prints_per_period:10};
let platformCookie='',ownerCookie='',memberCookie='',claims:NonNullable<ReturnType<typeof verifyPlatformTokenSignature>>;
function request(url:string,body:unknown,cookie=ownerCookie,key=randomUUID()){return new Request(origin+url,{method:'POST',headers:{origin,'content-type':'application/json',cookie,'idempotency-key':key},body:JSON.stringify(body)});}
function input(overrides:Record<string,unknown>={}){return parseManualSubscriptionInput({action:'save',expectedRevision:0,planId:'manual',subscriptionType:'paid',monthlyQuota:10,term:'yearly',startDate:new Date(Date.now()-60000).toISOString(),endDate:new Date(Date.now()+365*86400000).toISOString(),status:'active',reason:'Verified external agreement',...overrides});}
/** Construct an immutable customer request for Platform Owner approval tests.
 * Requests are allowed from the authenticated workspace owner; activation is not. */
async function seedPendingRequest(): Promise<{id: string}> {
 const id = `req_${randomUUID()}`;
 await db.transaction(async tx => {
   await tx.insert(subscriptionRequests).values({
     id, tenantId: 'workspace', requesterUserId: 'owner',
     requesterName: 'مالك موثق', requesterEmail: 'owner@manual.test',
     requesterVerifiedAt: new Date(), planId: 'manual', term: 'yearly',
     idempotencyKey: randomUUID(), requestDigest: randomUUID(), status: 'pending',
   });
   await ensurePendingManualSubscription(tx,'workspace','manual');
 });
 return {id};
}
suite('V4 manual subscriptions security and accounting',()=>{
 beforeAll(async()=>{await applyMigrations();});
 afterAll(async()=>{vi.unstubAllEnvs();await closePool();});
 beforeEach(async()=>{
  await truncateAll();vi.stubEnv('APP_BASE_URL',origin);vi.stubEnv('GATEWAY_JWT_SECRET','v4_manual_test_secret_123456789012345678901234567890');
  await db.insert(users).values([{id:'platform',email:'platform@manual.test',passwordHash:'test-password-version',emailVerifiedAt:new Date(),isPlatformOwner:true},{id:'owner',email:'owner@manual.test',displayName:'مالك موثق',passwordHash:'test-password-version',emailVerifiedAt:new Date()},{id:'member',email:'member@manual.test',passwordHash:'test-password-version',emailVerifiedAt:new Date()}]);
  await db.insert(tenants).values({id:'workspace',name:'Manual workspace'});
  await db.insert(tenantUsers).values([{tenantId:'workspace',userId:'owner',role:'owner'},{tenantId:'workspace',userId:'member',role:'admin'}]);
  await db.insert(plans).values({id:'manual',name:'Manual plan',entitlements});
  const platform=await createVerifiedPlatformSession('platform','platform@manual.test');platformCookie=`${sessionCookieName('platform')}=${platform.token}`;claims=verifyPlatformTokenSignature(platform.token)!;
  const owner=await issueWorkspaceTestSession({kind:'manager',tenantId:'workspace',userId:'owner',role:'owner'});ownerCookie=`${sessionCookieName('manager')}=${owner.accessToken}`;
  const member=await issueWorkspaceTestSession({kind:'manager',tenantId:'workspace',userId:'member',role:'admin'});memberCookie=`${sessionCookieName('manager')}=${member.accessToken}`;
 });

 it('returns the subscription end date only to the owner and uses DB time for expiry',async()=>{
  await mutateManualSubscription('workspace',claims,randomUUID(),input());
  const owner = await billingStatusGET(new Request(origin+'/api/billing/status',{headers:{cookie:ownerCookie}}));
  const member = await billingStatusGET(new Request(origin+'/api/billing/status',{headers:{cookie:memberCookie}}));
  expect(owner.status).toBe(200);expect(member.status).toBe(200);
  const ownData = await owner.json();
  const memberData = await member.json();
  expect(ownData).toMatchObject({hasSubscription:true,customerState:'active',currentPeriodEnd:expect.any(String)});
  expect(Date.parse(ownData.currentPeriodEnd)).toBeGreaterThan(Date.now());
  expect(memberData).not.toHaveProperty('currentPeriodEnd');
  expect(memberData).not.toHaveProperty('planId');
  expect(memberData).not.toHaveProperty('monthlyQuota');
  await db.update(tenantSubscriptions).set({currentPeriodEnd:new Date(Date.now()-1000)}).where(eq(tenantSubscriptions.tenantId,'workspace'));
  const expired = await billingStatusGET(new Request(origin+'/api/billing/status',{headers:{cookie:ownerCookie}}));
  expect((await expired.json())).toMatchObject({hasSubscription:false,customerState:'expired',currentPeriodEnd:expect.any(String)});
 });
 it('admin status matches runtime admission when contracts expire or lack a deadline', async () => {
  await mutateManualSubscription('workspace', claims, randomUUID(), input());
  const list = () => platformSubscriptionsGET(new Request(origin + '/api/platform/subscriptions', {headers: {cookie: platformCookie}}));
  const active = await list();
  expect(active.status).toBe(200);
  expect((await active.json()).subscriptions[0].status).toBe('active');
  await requireTenantBillingAccess(db, 'workspace');

  await db.update(tenantSubscriptions).set({currentPeriodEnd: null}).where(eq(tenantSubscriptions.tenantId, 'workspace'));
  const missing = await list();
  expect(missing.status).toBe(200);
  expect((await missing.json()).subscriptions[0].status).toBe('expired');
  await expect(requireTenantBillingAccess(db, 'workspace')).rejects.toBeInstanceOf(TenantSubscriptionRequiredError);

  await db.update(tenantSubscriptions).set({currentPeriodEnd: new Date(Date.now() - 60_000)}).where(eq(tenantSubscriptions.tenantId, 'workspace'));
  const expired = await list();
  expect((await expired.json()).subscriptions[0].status).toBe('expired');
  await expect(requireTenantBillingAccess(db, 'workspace')).rejects.toBeInstanceOf(TenantSubscriptionRequiredError);
 });
 it('deduplicates concurrent customer requests and requires independent Platform Owner approval',async()=>{
  const key=randomUUID();
  const responses=await Promise.all(Array.from({length:6},()=>requestActivation(
    request('/api/subscription-requests',{planId:'manual',term:'yearly',requesterUserId:'forged'},ownerCookie,key)
  )));
  expect(responses.map(r=>r.status).sort()).toEqual([200,200,200,200,200,201]);
  const pending=(await pool().query("SELECT * FROM subscription_requests")).rows;
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({tenant_id:'workspace',requester_user_id:'owner',status:'pending',plan_id:'manual'});
  expect((await db.query.tenantSubscriptions.findFirst())?.status).toBe('awaiting_activation');
  await expect(db.transaction(tx=>reserveTenantPrintCredit(tx,'workspace')))
    .rejects.toBeInstanceOf(TenantSubscriptionRequiredError);
  const denied=await requestActivation(request('/api/subscription-requests',{planId:'manual',term:'monthly'},memberCookie));
  expect(denied.status).toBe(403);
  const confidential=await requestsGET(new Request(origin+'/api/subscription-requests',{headers:{cookie:memberCookie}}));
  expect(confidential.status).toBe(403);
  expect(await confidential.json()).toMatchObject({code:'OWNER_REQUIRED'});
  const ownerRead=await requestsGET(new Request(origin+'/api/subscription-requests',{headers:{cookie:ownerCookie}}));
  expect(ownerRead.status).toBe(200);
  expect((await ownerRead.json()).requests).toHaveLength(1);
 });
 it('shows the actual customer request in Platform Admin and requires an exact linked approval',async()=>{
  const created=await requestActivation(request('/api/subscription-requests',{planId:'manual',term:'yearly'},ownerCookie));
  expect(created.status).toBe(201);
  const requestBody=await created.json();
  const id=String(requestBody.request.id);

  // Different customer intent cannot be silently acknowledged as the earlier request.
  const changed=await requestActivation(request('/api/subscription-requests',{planId:'manual',term:'monthly'},ownerCookie));
  expect(changed.status).toBe(409);
  expect(await changed.json()).toMatchObject({code:'SUBSCRIPTION_REQUEST_ALREADY_PENDING'});

  // Catalog changes must not rewrite the customer's requested allowance.
  await db.update(plans).set({entitlements:{...entitlements,max_prints_per_period:99}}).where(eq(plans.id,'manual'));
  const queue=await listPlatformRequests(new Request(origin+'/api/platform/subscription-requests?status=pending',{headers:{cookie:platformCookie}}));
  expect(queue.status).toBe(200);
  const pending=await queue.json();
  expect(pending.pendingCount).toBe(1);
  expect(pending.requests).toHaveLength(1);
  expect(pending.requests[0]).toMatchObject({
    id,tenant_id:'workspace',tenantName:'Manual workspace',plan_id:'manual',
    planName:'Manual plan',planMonthlyQuota:99,requested_monthly_quota:10,term:'yearly',
    requester_email:'owner@manual.test',status:'pending',
  });

  await expect(mutateManualSubscription('workspace',claims,randomUUID(),input({requestId:id,term:'monthly'})))
    .rejects.toMatchObject({code:'SUBSCRIPTION_REQUEST_TERMS_MISMATCH'});
  expect((await db.query.subscriptionRequests.findFirst())?.status).toBe('pending');

  await mutateManualSubscription('workspace',claims,randomUUID(),input({requestId:id}));
  expect((await db.query.subscriptionRequests.findFirst())?.status).toBe('approved');
  const after=await listPlatformRequests(new Request(origin+'/api/platform/subscription-requests?status=approved',{headers:{cookie:platformCookie}}));
  expect(after.status).toBe(200);
  expect((await after.json()).requests[0]).toMatchObject({id,status:'approved'});
  const customer=await requestsGET(new Request(origin+'/api/subscription-requests',{headers:{cookie:ownerCookie}}));
  expect(customer.status).toBe(200);
  expect((await customer.json()).requests[0]).toMatchObject({id,status:'approved'});
 });


 it.each(["monthly", "yearly"] as const)("begins a delayed %s subscription at actual approval, not the customer's request or stale form date",async term=>{
    const created=await requestActivation(request('/api/subscription-requests',{planId:'manual',term},ownerCookie));
    expect(created.status).toBe(201);
    const id=String((await created.json()).request.id);
    await db.update(subscriptionRequests).set({createdAt:new Date(Date.now()-2*86400000)}).where(eq(subscriptionRequests.id,id));
    const staleInput=input({requestId:id,term,startDate:"2026-01-01T00:00:00.000Z",endDate:"2027-01-01T00:00:00.000Z"});
    const key=randomUUID();
    const lower=new Date((await pool().query("SELECT clock_timestamp() AS now")).rows[0].now).getTime();
    const result=await mutateManualSubscription('workspace',claims,key,staleInput);
    const upper=new Date((await pool().query("SELECT clock_timestamp() AS now")).rows[0].now).getTime();
    const start=new Date(String(result.subscription.currentPeriodStart));
    const end=new Date(String(result.subscription.currentPeriodEnd));
    expect(start.getTime()).toBeGreaterThanOrEqual(lower);
    expect(start.getTime()).toBeLessThanOrEqual(upper);
    const expected=new Date(start);
    const originalDay=expected.getUTCDate();
    expected.setUTCDate(1);
    expected.setUTCMonth(expected.getUTCMonth()+(term==="monthly"?1:12));
    const finalDay=new Date(Date.UTC(expected.getUTCFullYear(),expected.getUTCMonth()+1,0)).getUTCDate();
    expected.setUTCDate(Math.min(originalDay,finalDay));
    expect(end.toISOString()).toBe(expected.toISOString());
    const approved=await db.query.subscriptionRequests.findFirst({where:eq(subscriptionRequests.id,id)});
    expect(approved?.lastActionAt?.toISOString()).toBe(start.toISOString());
    const replay=await mutateManualSubscription('workspace',claims,key,staleInput);
    expect(replay.replayed).toBe(true);
    expect(replay.subscription).toEqual(result.subscription);
  });

 it("keeps paid time remaining when a customer renewal is approved after a delay",async()=>{
    const contractStart="2026-03-15T13:15:00.000Z";
    const originalEnd="2027-03-15T13:15:00.000Z";
    await mutateManualSubscription('workspace',claims,randomUUID(),input({startDate:contractStart,endDate:originalEnd}));
    const created=await requestActivation(request('/api/subscription-requests',{planId:'manual',term:'yearly'},ownerCookie));
    expect(created.status).toBe(201);
    const id=String((await created.json()).request.id);
    const approved=await mutateManualSubscription('workspace',claims,randomUUID(),input({
      action:'renew',expectedRevision:1,requestId:id,term:'yearly',
      startDate:contractStart,endDate:"2027-03-16T00:00:00.000Z",
    }));
    expect(approved.subscription.currentPeriodStart).toBe(contractStart);
    expect(approved.subscription.currentPeriodEnd).toBe("2028-03-15T13:15:00.000Z");
    const record=await db.query.subscriptionRequests.findFirst({where:eq(subscriptionRequests.id,id)});
    expect(record?.lastActionAt).not.toBeNull();
    expect(record?.lastActionAt?.getTime()).toBeGreaterThan(new Date("2026-10-27T00:00:00Z").getTime());
  });
 it('approves monthly Go over an existing yearly contract without false revision errors, and records explicit changed terms',async()=>{
   await db.insert(plans).values({id:'go',name:'Go',entitlements:{...entitlements,max_prints_per_period:2000}});
   await mutateManualSubscription('workspace',claims,randomUUID(),input());
   const created=await requestActivation(request('/api/subscription-requests',{planId:'go',term:'monthly'},ownerCookie));
   expect(created.status).toBe(201);
   const requestId=String((await created.json()).request.id);
   const detail=await workspaceGET(new Request(origin+'/api/platform/tenants/workspace',{headers:{cookie:platformCookie}}),{params:Promise.resolve({id:'workspace'})});
   expect(detail.status).toBe(200);
   const data=await detail.json();
   expect(data.subscription.revision).toBe(1);
   expect(data.subscription.term).toBe('yearly');
   expect(data.requests[0]).toMatchObject({id:requestId,term:'monthly',requestedMonthlyQuota:2000});
   const start=new Date().toISOString();
   const end=new Date(Date.now()+32*86400000).toISOString();
   const change=input({action:'save',expectedRevision:data.subscription.revision,requestId,planId:'go',term:'monthly',monthlyQuota:2000,startDate:start,endDate:end});
   const wrong=input({...change,term:'yearly'});
   const context={params:Promise.resolve({id:'workspace'})};
   const denied=await subscriptionPOST(request('/api/platform/tenants/workspace/subscription',wrong,platformCookie),context);
   expect(denied.status).toBe(409);
   expect(await denied.json()).toMatchObject({code:'SUBSCRIPTION_REQUEST_TERMS_MISMATCH'});
   const key=randomUUID();
   const response=await subscriptionPOST(request('/api/platform/tenants/workspace/subscription',change,platformCookie,key),context);
   expect(response.status).toBe(200);
   expect(await response.json()).toMatchObject({replayed:false});
   const replay=await subscriptionPOST(request('/api/platform/tenants/workspace/subscription',change,platformCookie,key),context);
   expect(replay.status).toBe(200);
   expect(await replay.json()).toMatchObject({replayed:true});
   const actual=await db.query.tenantSubscriptions.findFirst();
   expect(actual).toMatchObject({planId:'go',term:'monthly',monthlyQuota:2000,status:'active',revision:2});
   expect((await db.query.subscriptionRequests.findFirst())).toMatchObject({
     id:requestId,status:'approved',approvalModified:false,approvedPlanId:'go',
     approvedTerm:'monthly',approvedMonthlyQuota:2000,
   });
   await expect(mutateManualSubscription('workspace',claims,randomUUID(),change)).rejects.toMatchObject({code:'SUBSCRIPTION_REQUEST_CONFLICT'});
 });
 it('audits a consciously overridden request rather than silently rewriting the requested terms',async()=>{
   await db.insert(plans).values({id:'go',name:'Go',entitlements:{...entitlements,max_prints_per_period:2000}});
   const created=await requestActivation(request('/api/subscription-requests',{planId:'go',term:'monthly'},ownerCookie));
   const requestId=String((await created.json()).request.id);
   const termOverride=input({requestId,planId:'go',term:'yearly',monthlyQuota:2000,
     allowRequestChanges:true,reason:'Customer and platform owner agreed to annual contract'});
   const result=await mutateManualSubscription('workspace',claims,randomUUID(),termOverride);
   expect(result.subscription.term).toBe('yearly');
   expect((await db.query.subscriptionRequests.findFirst())).toMatchObject({
     id:requestId,term:'monthly',approvedTerm:'yearly',approvalModified:true,status:'approved',
   });
   const read=await requestsGET(new Request(origin+'/api/subscription-requests',{headers:{cookie:ownerCookie}}));
   expect((await read.json()).requests[0]).toMatchObject({status:'approved',term:'monthly',approvedTerm:'yearly',approvalModified:true});
 });
 it('approves only the linked request, records history, and replays activation without changing revision or credits',async()=>{
  const record=await seedPendingRequest();
  const key=randomUUID(),body=input({requestId:record.id,subscriptionType:'free'});
  const [a,b]=await Promise.all([mutateManualSubscription('workspace',claims,key,body),mutateManualSubscription('workspace',claims,key,body)]);
  expect([a.replayed,b.replayed].sort()).toEqual([false,true]);expect((await pool().query('SELECT * FROM subscription_changes')).rowCount).toBe(1);
  expect((await pool().query('SELECT status,subscription_revision FROM subscription_requests')).rows[0]).toEqual({status:'approved',subscription_revision:1});
  await db.transaction(tx=>reserveTenantPrintCredit(tx,'workspace'));
  await mutateManualSubscription('workspace',claims,key,body);expect((await getTenantPrintUsage(db,'workspace')).used).toBe(1);
  await expect(mutateManualSubscription('workspace',claims,key,input({monthlyQuota:100}))).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
 });
 it('serializes admission and cannot spend more than the monthly quota under concurrency',async()=>{
  await mutateManualSubscription('workspace',claims,randomUUID(),input({monthlyQuota:3}));
  const results=await Promise.allSettled(Array.from({length:20},()=>db.transaction(tx=>reserveTenantPrintCredit(tx,'workspace'))));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(3);expect(results.filter(r=>r.status==='rejected').every(r=>r.status==='rejected'&&r.reason instanceof TenantPrintQuotaExceededError)).toBe(true);
  expect(await getTenantPrintUsage(db,'workspace')).toMatchObject({used:3,remaining:0,limit:3});
  const limits=await getTenantEntitlements(db,'workspace');expect(limits.max_agents).toBe('unlimited');expect(limits.max_printers).toBe('unlimited');expect(limits.max_concurrent_jobs).toBe(100);
 });
 it.each(['access','limit','credit'] as const)('rejects %s admission that waited past subscription expiry on an unchanged locked row',async(operation)=>{
  await mutateManualSubscription('workspace',claims,randomUUID(),input());
  await pool().query("UPDATE tenant_subscriptions SET current_period_end=clock_timestamp()+interval '1 second' WHERE tenant_id='workspace'");
  const locker=await pool().connect();
  try {
   await locker.query('BEGIN');
   await locker.query("SELECT tenant_id FROM tenant_subscriptions WHERE tenant_id='workspace' FOR UPDATE");
   const {rows:[{pid}]}=await locker.query<{pid:number}>('SELECT pg_backend_pid() AS pid');
   const admission=db.transaction(async tx=>operation==='access'?requireTenantBillingAccess(tx,'workspace'):operation==='limit'?getTenantEntitlementLimit(tx,'workspace','max_concurrent_jobs',true):reserveTenantPrintCredit(tx,'workspace'))
    .then(value=>({value,error:null}),error=>({value:null,error}));
   // Observe actual lock contention before advancing through the term boundary.
   await vi.waitFor(async()=>{
    const waiting=await pool().query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[pid]);
    expect(waiting.rows.length).toBeGreaterThan(0);
   });
   await vi.waitFor(async()=>{
    const expired=await pool().query("SELECT current_period_end<=clock_timestamp() AS expired FROM tenant_subscriptions WHERE tenant_id='workspace'");
    expect(expired.rows[0].expired).toBe(true);
   },{timeout:3000});
   // No UPDATE: PostgreSQL need not re-evaluate the original scan predicate.
   await locker.query('COMMIT');
   expect((await admission).error).toBeInstanceOf(TenantSubscriptionRequiredError);
   expect((await pool().query("SELECT * FROM print_monthly_usage WHERE tenant_id='workspace'")).rows).toHaveLength(0);
  } finally {await locker.query('ROLLBACK');locker.release();}
 });
 it('keeps admin monthly history free of overlapping archived rolling windows',async()=>{
   const current=(await pool().query("SELECT date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC') AS start")).rows[0].start;
   const monthStart=new Date(current);
   const monthEnd=new Date(Date.UTC(monthStart.getUTCFullYear(),monthStart.getUTCMonth()+1,1));
   const rollingStart=new Date(monthStart.getTime()+4*86_400_000);
   const rollingEnd=new Date(rollingStart.getTime()+30*86_400_000);
   await pool().query(
     "INSERT INTO print_monthly_usage (tenant_id,period_start,period_end,used_prints) VALUES ('workspace',$1,$2,4),('workspace',$3,$4,8)",
     [monthStart,monthEnd,rollingStart,rollingEnd],
   );
   const history=(await logicalUsageReport('workspace')).monthlyHistory as Array<{periodStart:Date|string;used:number|string}>;
   expect(history).toHaveLength(1);
   expect(new Date(history[0].periodStart).toISOString()).toBe(monthStart.toISOString());
   expect(Number(history[0].used)).toBe(4);
 });

 it('keeps credits separated by UTC calendar month rather than contract renewal',async()=>{
   await mutateManualSubscription('workspace',claims,randomUUID(),input());
   const current=await getTenantPrintUsage(db,'workspace');
   const previousStart=new Date(Date.UTC(current.periodStart.getUTCFullYear(),current.periodStart.getUTCMonth()-1,1));
   await db.execute(sql`INSERT INTO print_monthly_usage(tenant_id,period_start,period_end,used_prints)
     VALUES('workspace',${previousStart},${current.periodStart},10)`);
   const usage=await db.transaction(tx=>reserveTenantPrintCredit(tx,'workspace'));
   expect(usage.used).toBe(1);
   expect(usage.periodStart).toEqual(current.periodStart);
   expect(usage.periodEnd).toEqual(new Date(Date.UTC(current.periodStart.getUTCFullYear(),current.periodStart.getUTCMonth()+1,1)));
   expect((await db.query.tenantSubscriptions.findFirst())?.term).toBe('yearly');
 });
 it('resets the credit window at midnight UTC on January 1 and handles leap February',async()=>{
   const {quotaCycleStartSql,quotaCycleEndSql}=await import('../src/lib/quota-cycle');
   for(const [at,expectedStart,expectedEnd] of [
      ['2026-12-31 23:59:59.999','2026-12-01T00:00:00.000Z','2027-01-01T00:00:00.000Z'],
      ['2027-01-01 00:00:00','2027-01-01T00:00:00.000Z','2027-02-01T00:00:00.000Z'],
      ['2028-02-29 23:59:59.999','2028-02-01T00:00:00.000Z','2028-03-01T00:00:00.000Z'],
      ['2028-03-01 00:00:00','2028-03-01T00:00:00.000Z','2028-04-01T00:00:00.000Z'],
   ] as const){
      const atSql=sql`${at}::timestamp`;
      const result=await db.execute(sql`SELECT ${quotaCycleStartSql(atSql)} AS "started", ${quotaCycleEndSql(atSql)} AS "ended"`);
      const parse=(raw:unknown)=>raw instanceof Date?raw:new Date(String(raw).replace(" ","T")+"Z");
      expect(parse(result.rows[0].started).toISOString()).toBe(expectedStart);
      expect(parse(result.rows[0].ended).toISOString()).toBe(expectedEnd);
   }
 });
 it('rejects reactivation of suspended contracts without an expiry and keeps billing fail-closed',async()=>{
   await mutateManualSubscription('workspace',claims,randomUUID(),input());
   await mutateManualSubscription('workspace',claims,randomUUID(),input({action:'suspend',expectedRevision:1}));
   await db.update(tenantSubscriptions).set({currentPeriodEnd:null}).where(eq(tenantSubscriptions.tenantId,'workspace'));
   await expect(mutateManualSubscription('workspace',claims,randomUUID(),input({action:'reactivate',expectedRevision:2})))
     .rejects.toMatchObject({code:'SUBSCRIPTION_EXPIRED',status:409});
   const record=await db.query.tenantSubscriptions.findFirst({where:eq(tenantSubscriptions.tenantId,'workspace')});
   expect(record).toMatchObject({status:'suspended',currentPeriodEnd:null,revision:2});
   await expect(getTenantEntitlements(db,'workspace')).rejects.toBeInstanceOf(TenantSubscriptionRequiredError);
 });
 it('refuses ineffective manual subscription reactivation without changing revision',async()=>{
  await mutateManualSubscription('workspace',claims,randomUUID(),input());
  await mutateManualSubscription('workspace',claims,randomUUID(),input({action:'suspend',expectedRevision:1}));
  await db.update(tenants).set({lifecycle:'suspended'}).where(eq(tenants.id,'workspace'));
  await expect(mutateManualSubscription('workspace',claims,randomUUID(),input({action:'reactivate',expectedRevision:2})))
    .rejects.toMatchObject({code:'WORKSPACE_NOT_ACTIVE',status:409});
  await db.update(tenants).set({lifecycle:'active'}).where(eq(tenants.id,'workspace'));
  await db.update(tenantSubscriptions).set({currentPeriodStart:new Date(Date.now()+86_400_000)})
    .where(eq(tenantSubscriptions.tenantId,'workspace'));
  await expect(mutateManualSubscription('workspace',claims,randomUUID(),input({action:'reactivate',expectedRevision:2})))
    .rejects.toMatchObject({code:'SUBSCRIPTION_NOT_STARTED',status:409});
  expect(await db.query.tenantSubscriptions.findFirst({where:eq(tenantSubscriptions.tenantId,'workspace')}))
    .toMatchObject({status:'suspended',revision:2});
  await expect(requireTenantBillingAccess(db,'workspace')).rejects.toBeInstanceOf(TenantSubscriptionRequiredError);
  await db.update(tenantSubscriptions).set({currentPeriodStart:new Date(Date.now()-60_000)})
    .where(eq(tenantSubscriptions.tenantId,'workspace'));
  await mutateManualSubscription('workspace',claims,randomUUID(),input({action:'reactivate',expectedRevision:2}));
  expect((await db.query.tenantSubscriptions.findFirst({where:eq(tenantSubscriptions.tenantId,'workspace')}))?.status).toBe('active');
  await requireTenantBillingAccess(db,'workspace');
 });
 it('renewal/quota edits preserve usage; suspension and expiry block admission; cancel at term remains usable until expiry',async()=>{
  await mutateManualSubscription('workspace',claims,randomUUID(),input());
   const originalAnchor=(await db.query.tenantSubscriptions.findFirst())?.printCycleAnchor;
   expect(originalAnchor).toBeInstanceOf(Date);
   await db.transaction(tx=>reserveTenantPrintCredit(tx,'workspace'));
  const renewKey=randomUUID(),renew=input({action:'renew',expectedRevision:1,monthlyQuota:20,endDate:new Date(Date.now()+730*86400000).toISOString()});
  await mutateManualSubscription('workspace',claims,renewKey,renew);await mutateManualSubscription('workspace',claims,renewKey,renew);
  expect(await getTenantPrintUsage(db,'workspace')).toMatchObject({used:1,limit:20});
   expect((await db.query.tenantSubscriptions.findFirst())?.printCycleAnchor).toEqual(originalAnchor);
  await mutateManualSubscription('workspace',claims,randomUUID(),input({action:'suspend',expectedRevision:2}));await expect(db.transaction(tx=>reserveTenantPrintCredit(tx,'workspace'))).rejects.toBeInstanceOf(TenantSubscriptionRequiredError);
  await mutateManualSubscription('workspace',claims,randomUUID(),input({action:'reactivate',expectedRevision:3}));
  await mutateManualSubscription('workspace',claims,randomUUID(),input({action:'cancel_at_end',expectedRevision:4}));expect((await db.query.tenantSubscriptions.findFirst())?.cancelAtPeriodEnd).toBe(true);expect((await getTenantPrintUsage(db,'workspace')).used).toBe(1);
  await db.update(tenantSubscriptions).set({currentPeriodEnd:new Date(Date.now()-1000)}).where(eq(tenantSubscriptions.tenantId,'workspace'));await expect(getTenantPrintUsage(db,'workspace')).rejects.toBeInstanceOf(TenantSubscriptionRequiredError);
 });
 it('rejects stale revision, cross-tenant request approval, missing recent password and customer platform mutations',async()=>{
  await mutateManualSubscription('workspace',claims,randomUUID(),input());
  await expect(mutateManualSubscription('workspace',claims,randomUUID(),input())).rejects.toMatchObject({code:'SUBSCRIPTION_REVISION_CONFLICT'});
  await expect(mutateManualSubscription('workspace',claims,randomUUID(),input({expectedRevision:1,requestId:'foreign-request'}))).rejects.toMatchObject({code:'SUBSCRIPTION_REQUEST_CONFLICT'});expect((await db.query.tenantSubscriptions.findFirst())?.revision).toBe(1);
  const customer=await subscriptionPOST(request('/api/platform/tenants/workspace/subscription',input(),memberCookie),{params:Promise.resolve({id:'workspace'})});expect(customer.status).toBe(401);
  await pool().query("UPDATE platform_session_security SET password_verified_at=clock_timestamp()-interval '6 minutes'");
  const stale=await subscriptionPOST(request('/api/platform/tenants/workspace/subscription',input({expectedRevision:1}),platformCookie),{params:Promise.resolve({id:'workspace'})});expect(stale.status).toBe(403);
 });
 it('retired provider calls cannot modify manual state and pending helper never overwrites existing activation',async()=>{
  await mutateManualSubscription('workspace',claims,randomUUID(),input());await db.transaction(tx=>ensurePendingManualSubscription(tx,'workspace','manual'));
  expect((await webhookPOST(request('/api/billing/webhook',{type:'customer.subscription.updated'}))).status).toBe(410);expect((await checkoutPOST(request('/api/billing/checkout',{planId:'manual'}))).status).toBe(410);expect((await db.query.tenantSubscriptions.findFirst())?.status).toBe('active');
 });
 it('idempotent print retries consume one credit and live/receipt overlap reports one logical job',async()=>{
  const f=await seedFixture();await db.update(tenantSubscriptions).set({monthlyQuota:10}).where(eq(tenantSubscriptions.tenantId,f.tenantId));
  const payload={type:'raw',protocol:'raw',encoding:'base64',data:Buffer.from('manual test').toString('base64')};
  const opts={tenantId:f.tenantId,requestedBy:'manual test',idempotencyKey:'logical-replay',destination:f.destination};
  const results=await Promise.all(Array.from({length:6},()=>createPrintJobForPrinter(f.printerId,payload,opts)));expect(results.filter(r=>!r.isReused)).toHaveLength(1);expect((await getTenantPrintUsage(db,f.tenantId)).used).toBe(1);
  await pool().query(`INSERT INTO print_job_receipts(id,tenant_id,fingerprint,printer_id,agent_id,status,created_at,updated_at) SELECT id,tenant_id,'test',printer_id,agent_id,'success',created_at,updated_at FROM print_jobs WHERE tenant_id=$1`,[f.tenantId]);
  expect(await logicalUsageReport(f.tenantId)).toMatchObject({today:1,month:1,year:1});
 });
 it('workspace 360 effective state agrees with expiry, future start, entitlement block and workspace suspension',async()=>{
  await mutateManualSubscription('workspace',claims,randomUUID(),input());
  const read=async()=>{const r=await workspaceGET(new Request(origin+'/api/platform/tenants/workspace',{headers:{cookie:platformCookie}}),{params:Promise.resolve({id:'workspace'})});expect(r.status).toBe(200);return (await r.json()).subscription;};
  expect(await read()).toMatchObject({status:'active',effectiveStatus:'active'});
  await db.update(tenantSubscriptions).set({currentPeriodEnd:new Date(Date.now()-1000)});expect(await read()).toMatchObject({status:'active',effectiveStatus:'expired'});
  await db.update(tenantSubscriptions).set({currentPeriodEnd:new Date(Date.now()+86400000),currentPeriodStart:new Date(Date.now()+60000)});expect(await read()).toMatchObject({effectiveStatus:'awaiting_activation'});
  await db.update(tenantSubscriptions).set({currentPeriodStart:new Date(Date.now()-60000),entitlementBlocked:true});expect(await read()).toMatchObject({effectiveStatus:'suspended'});
  await db.update(tenantSubscriptions).set({entitlementBlocked:false});await db.update(tenants).set({lifecycle:'suspended'}).where(eq(tenants.id,'workspace'));expect(await read()).toMatchObject({status:'active',effectiveStatus:'suspended'});
 });
 it('preserves actual contract dates in the atomic audit event',async()=>{
  const body=input();await mutateManualSubscription('workspace',claims,randomUUID(),body);
  const audit=await pool().query("SELECT metadata FROM audit_events WHERE action='subscription.save'");
  expect(audit.rows[0].metadata.after.currentPeriodStart).toBe(body.startDate);expect(audit.rows[0].metadata.after.currentPeriodEnd).toBe(body.endDate);
  expect(audit.rows[0].metadata.after).toMatchObject({entitlementBlocked:false,entitlementBlockedReason:null});
  await db.update(tenantSubscriptions).set({entitlementBlocked:true,entitlementBlockedReason:'Review hold'}).where(eq(tenantSubscriptions.tenantId,'workspace'));
  await mutateManualSubscription('workspace',claims,randomUUID(),input({expectedRevision:1}));
  const lift=(await pool().query("SELECT metadata FROM audit_events WHERE action='subscription.save' ORDER BY created_at DESC LIMIT 1")).rows[0].metadata;
  expect(lift.before).toMatchObject({entitlementBlocked:true,entitlementBlockedReason:'Review hold'});expect(lift.after.entitlementBlocked).toBe(false);
 });
 it('binds request rejection retries and serializes concurrent approval/rejection without deadlock',async()=>{
  const r=await seedPendingRequest();
  const key=randomUUID(),body={id:r.id,reason:'Not approved'};
  const decisions=await Promise.all([rejectRequest(request('/api/platform/subscription-requests',body,platformCookie,key)),subscriptionPOST(request('/api/platform/tenants/workspace/subscription',input({requestId:r.id}),platformCookie),{params:Promise.resolve({id:'workspace'})})]);
  expect(decisions.map(r=>r.status).sort()).toEqual([200,409]);
  const final=(await pool().query('SELECT status FROM subscription_requests')).rows[0].status;
  if(final==='rejected'){
   expect((await rejectRequest(request('/api/platform/subscription-requests',body,platformCookie,key))).status).toBe(200);
   expect((await rejectRequest(request('/api/platform/subscription-requests',{...body,reason:'Different reason'},platformCookie,key))).status).toBe(409);
   expect((await rejectRequest(request('/api/platform/subscription-requests',body,platformCookie,randomUUID()))).status).toBe(409);
  }else expect(final).toBe('approved');
 });

 it('scopes concurrent plan creation idempotency to the actor and request key',async()=>{
  // Two different plan IDs must not be created under one operation identity.
  // An ID-scoped advisory lock alone fails to serialize this collision.
  const key=randomUUID();
  const candidate=(id:string)=>({id,name:id,description:'',monthlyQuota:600,isActive:true,isPublic:true,displayOrder:1});
  const [first,second]=await Promise.all([
    createPlan(request('/api/platform/plans',candidate('plan_key_first'),platformCookie,key)),
    createPlan(request('/api/platform/plans',candidate('plan_key_second'),platformCookie,key)),
  ]);
  expect([first.status,second.status].sort()).toEqual([201,409]);
  const persisted=await pool().query("SELECT id FROM plans WHERE id IN ($1,$2)",
    ['plan_key_first','plan_key_second']);
  expect(persisted.rows).toHaveLength(1);
  const audit=await pool().query(
    "SELECT id FROM audit_events WHERE actor_type='platform' AND actor_id='platform' AND action='plan.created' AND request_id=$1",
    [key]);
  expect(audit.rows).toHaveLength(1);
 });

 it('serializes one platform plan edit key across distinct plan IDs',async()=>{
  await db.insert(plans).values({id:'another_plan',name:'Other manual plan',entitlements});
  const key=randomUUID();
  const patch=(id:string,name:string)=>editPlan(new Request(origin+'/api/platform/plans/'+id,{
    method:'PATCH',headers:{origin,'content-type':'application/json',cookie:platformCookie,'idempotency-key':key},
    body:JSON.stringify({name,description:'',monthlyQuota:250,isActive:true,isPublic:true,displayOrder:0}),
  }),{params:Promise.resolve({id})});
  const [a,b]=await Promise.all([
    patch('manual','Edited primary plan'),
    patch('another_plan','Edited secondary plan'),
  ]);
  expect([a.status,b.status].sort()).toEqual([200,409]);
  const rows=(await pool().query("SELECT id,name FROM plans WHERE id IN ('manual','another_plan')")).rows;
  expect(rows.filter(row=>row.name.startsWith('Edited '))).toHaveLength(1);
  const events=(await pool().query(
    "SELECT id FROM audit_events WHERE actor_type='platform' AND actor_id='platform' AND action='plan.updated' AND request_id=$1",
    [key])).rows;
  expect(events).toHaveLength(1);
 });

 it('persists and edits published USD/SAR prices without mutating subscriptions',async()=>{
  const plan={id:'priced',name:'Published plan',description:'',monthlyQuota:500,priceAmount:'19.95',priceCurrency:'USD',isActive:true,isPublic:true,displayOrder:1};
  const key=randomUUID();
  expect((await createPlan(request('/api/platform/plans',plan,platformCookie,key))).status).toBe(201);
  expect((await createPlan(request('/api/platform/plans',plan,platformCookie,key))).status).toBe(201);
  expect((await createPlan(request('/api/platform/plans',{...plan,priceAmount:'20'},platformCookie,key))).status).toBe(409);
  expect(await db.query.plans.findFirst({where:eq(plans.id,'priced')})).toMatchObject({priceMinorUnits:1995,priceCurrency:'USD'});
  const publicCatalog=await publicPlansGET();
  expect((await publicCatalog.json()).plans).toEqual(expect.arrayContaining([expect.objectContaining({id:'priced',priceMinorUnits:1995,priceCurrency:'USD'})]));
  const adminCatalog=await listAdminPlans(new Request(origin+'/api/platform/plans',{headers:{cookie:platformCookie}}));
  expect(adminCatalog.status).toBe(200);
  expect((await adminCatalog.json()).plans).toEqual(expect.arrayContaining([expect.objectContaining({id:'priced',priceMinorUnits:1995,priceCurrency:'USD'})]));
  await mutateManualSubscription('workspace',claims,randomUUID(),input({planId:'priced',monthlyQuota:75}));
  const context={params:Promise.resolve({id:'priced'})};
  const patch=(body:Record<string,unknown>,k=randomUUID())=>editPlan(
    new Request(origin+'/api/platform/plans/priced',{method:'PATCH',headers:{origin,'content-type':'application/json',cookie:platformCookie,'idempotency-key':k},body:JSON.stringify(body)}),context);
  const revised={...plan,name:'Updated plan',monthlyQuota:999,priceAmount:'54.25',priceCurrency:'SAR'};
  expect((await patch(revised)).status).toBe(200);
  expect(await db.query.plans.findFirst({where:eq(plans.id,'priced')})).toMatchObject({priceMinorUnits:5425,priceCurrency:'SAR'});
  expect(await db.query.tenantSubscriptions.findFirst({where:eq(tenantSubscriptions.tenantId,'workspace')})).toMatchObject({planId:'priced',status:'active',monthlyQuota:75});
  const legacy={id:'priced',name:'Legacy patch',description:'',monthlyQuota:999,isActive:true,isPublic:true,displayOrder:1};
  expect((await patch(legacy)).status).toBe(200);
  expect(await db.query.plans.findFirst({where:eq(plans.id,'priced')})).toMatchObject({priceMinorUnits:5425,priceCurrency:'SAR'});
  for(const bad of [{...legacy,priceAmount:'10.001',priceCurrency:'SAR'},{...legacy,priceAmount:'20',priceCurrency:'EUR'},{...legacy,priceAmount:'25',priceCurrency:null}])
    expect((await patch(bad)).status).toBe(400);
  expect((await patch({...legacy,priceAmount:null,priceCurrency:null})).status).toBe(200);
  expect(await db.query.plans.findFirst({where:eq(plans.id,'priced')})).toMatchObject({priceMinorUnits:null,priceCurrency:null});
  expect(await db.query.tenantSubscriptions.findFirst({where:eq(tenantSubscriptions.tenantId,'workspace')})).toMatchObject({planId:'priced',monthlyQuota:75});
 });
 it('audits the actual preserved technical plan limits',async()=>{
  await db.update(plans).set({entitlements:{...entitlements,max_concurrent_jobs:7,max_jobs_per_minute:19}}).where(eq(plans.id,'manual'));
  const r=await editPlan(request('/api/platform/plans/manual',{name:'Revised',description:'Monthly allowance',monthlyQuota:30,isActive:true,isPublic:true},platformCookie),{params:Promise.resolve({id:'manual'})});expect(r.status).toBe(200);
  const audit=(await pool().query("SELECT metadata FROM audit_events WHERE action='plan.updated'")).rows[0].metadata;
  expect(audit.after.entitlements).toMatchObject({max_concurrent_jobs:7,max_jobs_per_minute:19,max_prints_per_period:30});
 });
 it('binds workspace lifecycle retries and retains the supplied reactivation reason',async()=>{
  const before=await db.query.tenants.findFirst({where:eq(tenants.id,'workspace')});const key=randomUUID(),body={reason:'Operational review',expectedLifecycle:'active',expectedUpdatedAt:before!.updatedAt.toISOString()};
  const ctx={params:Promise.resolve({id:'workspace'})};expect((await suspendWorkspace(request('/api/platform/tenants/workspace/suspend',body,platformCookie,key),ctx)).status).toBe(200);
  const suspended=await db.query.tenants.findFirst({where:eq(tenants.id,'workspace')});
  const active=await reactivateWorkspace(request('/api/platform/tenants/workspace/reactivate',{reason:'Owner verified restoration',expectedLifecycle:'suspended',expectedUpdatedAt:suspended!.updatedAt.toISOString()},platformCookie),ctx);expect(active.status).toBe(200);
  expect((await suspendWorkspace(request('/api/platform/tenants/workspace/suspend',body,platformCookie,key),ctx)).status).toBe(200);
  expect((await db.query.tenants.findFirst({where:eq(tenants.id,'workspace')}))?.lifecycle).toBe('active');
  expect((await suspendWorkspace(request('/api/platform/tenants/workspace/suspend',body,platformCookie,randomUUID()),ctx)).status).toBe(409);
  expect((await pool().query("SELECT metadata FROM audit_events WHERE action='tenant.lifecycle.active'")).rows[0].metadata.reason).toBe('Owner verified restoration');
 });
 it('workspace 360 and platform overview run real metadata queries without secrets',async()=>{
  await mutateManualSubscription('workspace',claims,randomUUID(),input());
  const response=await workspaceGET(new Request(origin+'/api/platform/tenants/workspace',{headers:{cookie:platformCookie}}),{params:Promise.resolve({id:'workspace'})});expect(response.status).toBe(200);const body=await response.json();expect(body.workspace.ownerEmail).toBe('owner@manual.test');expect(JSON.stringify(body)).not.toContain('passwordHash');
  const stats=await statsGET(new Request(origin+'/api/platform/stats',{headers:{cookie:platformCookie}}));expect(stats.status).toBe(200);expect(await stats.json()).toMatchObject({business:{active:1},logicalUsage:{today:0,month:0,year:0}});
  await db.update(tenants).set({lifecycle:'suspended'}).where(eq(tenants.id,'workspace'));
  const suspended=await statsGET(new Request(origin+'/api/platform/stats',{headers:{cookie:platformCookie}}));expect(await suspended.json()).toMatchObject({business:{active:0,suspended:1}});
 });
});
