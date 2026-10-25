import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq,sql } from "drizzle-orm";
import { db } from "../src/db";
import { users,tenants,tenantUsers,plans,tenantSubscriptions } from "../src/db/schema";
import { applyMigrations,closePool,hasTestDatabase,pool,seedFixture,truncateAll } from "./helpers/pg";
import { createVerifiedPlatformSession } from "./helpers/platform-session";
import { issueWorkspaceTestSession } from "./helpers/workspace-session";
import { sessionCookieName } from "../src/lib/session-config";
import { verifyPlatformTokenSignature } from "../src/lib/platform-auth";
import { mutateManualSubscription,ensurePendingManualSubscription,parseManualSubscriptionInput } from "../src/lib/manual-subscriptions";
import { getTenantPrintUsage,getTenantEntitlements,reserveTenantPrintCredit,TenantPrintQuotaExceededError,TenantSubscriptionRequiredError } from "../src/lib/entitlements";
import { POST as requestActivation,GET as requestsGET } from "../src/app/api/subscription-requests/route";
import { POST as subscriptionPOST } from "../src/app/api/platform/tenants/[id]/subscription/route";
import { GET as workspaceGET } from "../src/app/api/platform/tenants/[id]/route";
import { POST as rejectRequest } from "../src/app/api/platform/subscription-requests/route";
import { PATCH as editPlan } from "../src/app/api/platform/plans/[id]/route";
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
 it('creates one authenticated request under concurrent retry and never activates the workspace',async()=>{
  const key=randomUUID();const responses=await Promise.all(Array.from({length:6},()=>requestActivation(request('/api/subscription-requests',{planId:'manual',term:'yearly',requesterUserId:'forged'},ownerCookie,key))));
  expect(responses.map(r=>r.status).every(s=>s===200||s===201)).toBe(true);
  const rows=await pool().query('SELECT * FROM subscription_requests');expect(rows.rows).toHaveLength(1);expect(rows.rows[0]).toMatchObject({tenant_id:'workspace',requester_user_id:'owner',requester_email:'owner@manual.test',requester_name:'مالك موثق',status:'pending'});
  expect((await db.query.tenantSubscriptions.findFirst())?.status).toBe('awaiting_activation');
  await expect(db.transaction(tx=>reserveTenantPrintCredit(tx,'workspace'))).rejects.toBeInstanceOf(TenantSubscriptionRequiredError);
  const forbidden=await requestActivation(request('/api/subscription-requests',{planId:'manual',term:'monthly'},memberCookie));expect(forbidden.status).toBe(403);
  const safe=await requestsGET(new Request(origin+'/api/subscription-requests',{headers:{cookie:memberCookie}}));expect(await safe.json()).toMatchObject({requests:[],hasSubscription:false,status:'awaiting_activation'});
 });
 it('approves only the linked request, records history, and replays activation without changing revision or credits',async()=>{
  const r=await requestActivation(request('/api/subscription-requests',{planId:'manual',term:'yearly'}));const {request:record}=await r.json();
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
 it('uses the UTC calendar month during an annual term and ignores previous-month consumption',async()=>{
  await mutateManualSubscription('workspace',claims,randomUUID(),input());
  await db.execute(sql`INSERT INTO print_monthly_usage(tenant_id,period_start,period_end,used_prints) VALUES('workspace',date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '1 month',date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC'),10)`);
  const usage=await db.transaction(tx=>reserveTenantPrintCredit(tx,'workspace'));expect(usage.used).toBe(1);expect(usage.periodStart.getUTCDate()).toBe(1);expect(usage.periodStart.getUTCHours()).toBe(0);expect(usage.periodEnd!.getUTCDate()).toBe(1);
  expect((await db.query.tenantSubscriptions.findFirst())?.term).toBe('yearly');
 });
 it('renewal/quota edits preserve usage; suspension and expiry block admission; cancel at term remains usable until expiry',async()=>{
  await mutateManualSubscription('workspace',claims,randomUUID(),input());await db.transaction(tx=>reserveTenantPrintCredit(tx,'workspace'));
  const renewKey=randomUUID(),renew=input({action:'renew',expectedRevision:1,monthlyQuota:20,endDate:new Date(Date.now()+730*86400000).toISOString()});
  await mutateManualSubscription('workspace',claims,renewKey,renew);await mutateManualSubscription('workspace',claims,renewKey,renew);
  expect(await getTenantPrintUsage(db,'workspace')).toMatchObject({used:1,limit:20});
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
  const created=await requestActivation(request('/api/subscription-requests',{planId:'manual',term:'yearly'}));const {request:r}=await created.json();
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
