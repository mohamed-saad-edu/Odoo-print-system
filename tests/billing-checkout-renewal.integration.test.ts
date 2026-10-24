import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../src/db";
import { plans, tenantSubscriptions, users } from "../src/db/schema";
import { POST as checkout } from "../src/app/api/billing/checkout/route";
import { POST as cancel } from "../src/app/api/billing/cancel/route";
import { POST as resume } from "../src/app/api/billing/resume/route";
import { POST as portal } from "../src/app/api/billing/portal/route";
import { POST as createPlan } from "../src/app/api/platform/plans/route";
import { PATCH as updatePlan } from "../src/app/api/platform/plans/[id]/route";
import { hashPassword } from "../src/lib/password";
import { platformCookieHeader } from "../src/lib/platform-auth";
import { applyMigrations, closePool, hasTestDatabase, pool, truncateAll } from "./helpers/pg";
import { createVerifiedPlatformSession } from "./helpers/platform-session";
import { gatewayTestSigningKey } from "./helpers/test-secrets";
import { seedRetiredBilling, billingEvidenceSnapshot, expectManualRetirement } from "./helpers/manual-billing-retirement";
vi.mock(import("../src/lib/stripe"), async original => ({ ...(await original()), stripeRequest:vi.fn(), stripeRetrieve:vi.fn(), stripeList:vi.fn(), validateStripePriceBinding:vi.fn() }));
const suite=describe.skipIf(!hasTestDatabase);
let passwordHash:string;
beforeAll(async()=>{vi.stubEnv("GATEWAY_JWT_SECRET",gatewayTestSigningKey());vi.stubEnv("APP_BASE_URL","https://billing.test");passwordHash=await hashPassword("synthetic-v4-catalog-password");await applyMigrations();});
beforeEach(async()=>{await truncateAll();vi.clearAllMocks();});
afterAll(async()=>{vi.unstubAllEnvs();await closePool();});
async function noProviderCalls(){const provider=await import("../src/lib/stripe");for(const fn of [provider.stripeRequest,provider.stripeRetrieve,provider.stripeList,provider.validateStripePriceBinding])expect(fn).not.toHaveBeenCalled();}

suite("V4 manual renewal cannot open a provider session",()=>{
  it.each(["awaiting_activation","active","expired","suspended","cancelled","incomplete_expired","trialing","past_due"])("keeps %s unchanged through all retired customer billing mutations",async status=>{
    const f=await seedRetiredBilling(status);const before=await billingEvidenceSnapshot();
    for(const [route,handler] of [["checkout",checkout],["cancel",cancel],["resume",resume],["portal",portal]] as const){
      const request=new Request(`https://billing.test/api/billing/${route}`,{method:"POST",headers:{origin:"https://billing.test","content-type":"application/json"},body:JSON.stringify({planId:f.planId})});
      await expectManualRetirement(await handler(request));
    }
    expect(await billingEvidenceSnapshot()).toEqual(before);await noProviderCalls();
  });
});

suite("V4 manual catalog retains platform authorization and historical billing evidence",()=>{
  async function platformRequest(body:Record<string,unknown>,method:"POST"|"PATCH",id:string){
    await db.insert(users).values({id:"catalog_owner",email:"catalog-owner@example.invalid",passwordHash,isPlatformOwner:true,emailVerifiedAt:new Date()});
    const session=await createVerifiedPlatformSession("catalog_owner","catalog-owner@example.invalid");
    return new Request(`https://billing.test/api/platform/plans/${id}`,{method,headers:{origin:"https://billing.test","content-type":"application/json","Idempotency-Key":randomUUID(),cookie:platformCookieHeader(session.token,session.exp).split(";")[0]},body:JSON.stringify(body)});
  }
  it.each(["POST","PATCH"] as const)("rechecks platform owner after waiting for the catalog lock (%s)",async method=>{
    const f=await seedRetiredBilling();const id=method==="POST"?"new_manual_plan":f.planId;
    const request=await platformRequest({id,name:"Manual catalog",description:"Monthly job allowance",monthlyQuota:500},method,id);
    const blocker=await pool().connect();
    await blocker.query("BEGIN");await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`manual-plan:${id}`]);
    const operation=method==="POST"?createPlan(request):updatePlan(request,{params:Promise.resolve({id})});
    void operation.catch(()=>undefined);
    try {
      await vi.waitFor(async()=>{
        const waiting=await pool().query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%hashtextextended%' AND pid<>pg_backend_pid()");
        expect(waiting.rowCount).toBeGreaterThan(0);
      },{timeout:5000,interval:10});
      await db.update(users).set({isPlatformOwner:false}).where(eq(users.id,"catalog_owner"));
    } finally {await blocker.query("COMMIT");blocker.release();}
    expect((await operation).status).toBe(403);
    if(method==="POST")expect(await db.query.plans.findFirst({where:eq(plans.id,id)})).toBeUndefined();
    else expect((await db.query.plans.findFirst({where:eq(plans.id,id)}))?.name).not.toBe("Manual catalog");
    await noProviderCalls();
  });
  it("archives the catalog without provider access or resetting an existing workspace quota",async()=>{
    const f=await seedRetiredBilling();
    await db.update(plans).set({stripePriceId:"price_historical",stripeProductId:"prod_historical",entitlements:{max_agents:1,max_printers:1,max_jobs_per_minute:7,max_concurrent_jobs:9,max_prints_per_period:250}}).where(eq(plans.id,f.planId));
    const before=await db.query.tenantSubscriptions.findFirst({where:eq(tenantSubscriptions.tenantId,f.tenantId)});
    const request=await platformRequest({name:"Archived manual catalog",description:"Historical plan",monthlyQuota:500,isActive:false},"PATCH",f.planId);
    expect((await updatePlan(request,{params:Promise.resolve({id:f.planId})})).status).toBe(200);
    const plan=await db.query.plans.findFirst({where:eq(plans.id,f.planId)});
    expect(plan).toMatchObject({isActive:false,stripePriceId:"price_historical",stripeProductId:"prod_historical",entitlements:{max_agents:"unlimited",max_printers:"unlimited",max_jobs_per_minute:7,max_concurrent_jobs:9,max_prints_per_period:500}});
    expect(await db.query.tenantSubscriptions.findFirst({where:eq(tenantSubscriptions.tenantId,f.tenantId)})).toEqual(before);
    await noProviderCalls();
  });
});
