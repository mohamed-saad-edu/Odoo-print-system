// @vitest-environment jsdom
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../src/i18n/react";
import { translate } from "../src/i18n/translate";
const fixture=vi.hoisted(()=>({authenticated:false,role:"owner",status:"active",blocked:false,locale:"en" as "en"|"ar",query:""}));
vi.mock("next/headers",()=>({cookies:async()=>({get:(name:string)=>({value:name==="yaseir_locale"?fixture.locale:"session"})})}));
vi.mock("next/link",()=>({default:({children,...props}:Record<string,unknown>)=>h("a",props,children as ReactNode)}));
vi.mock("../src/lib/manager-auth",()=>({getManagerCookieName:()=>"mgr_session",verifyWorkspaceTokenFromCookieValues:async()=>fixture.authenticated?{role:fixture.role,tenantId:"tenant"}:null}));
vi.mock("../src/lib/database-clock",()=>({databaseNowMs:async()=>Date.parse("2030-05-15T00:00:00Z")}));
vi.mock("../src/db",()=>({db:{query:{tenantSubscriptions:{findFirst:async()=>({planId:"manual-plan",status:fixture.status,currentPeriodStart:new Date("2030-01-01T00:00:00Z"),currentPeriodEnd:new Date("2031-01-01T00:00:00Z"),entitlementBlocked:fixture.blocked})},tenants:{findFirst:async()=>({lifecycle:"active"})}},select:()=>({from:()=>({where:(query:Parameters<PgDialect["sqlToQuery"]>[0])=>{fixture.query=new PgDialect().sqlToQuery(query).sql;return {orderBy:async()=>[{id:"manual-plan",name:"Manual public plan",description:null,entitlements:{max_prints_per_period:1000,max_agents:1,max_printers:1,max_concurrent_jobs:10,max_jobs_per_minute:10}}]};}})})}}));
import Pricing from "../src/app/pricing/page";
beforeEach(()=>{localStorage.clear();fixture.authenticated=false;fixture.role="owner";fixture.status="active";fixture.blocked=false;fixture.locale="en";document.cookie="yaseir_locale=en; path=/";fixture.query="";});
async function render(){return renderToStaticMarkup(h(I18nProvider,{initialLocale:fixture.locale,children:await Pricing()}));}
describe("public manual plan catalog",()=>{
 it("includes active public plans without a provider price identifier",async()=>{const markup=await render();expect(markup).toContain("Manual public plan");expect(fixture.query).toContain("is_active");expect(fixture.query).toContain("is_public");expect(fixture.query).not.toContain("stripe");expect(markup).toContain('/signup?plan=manual-plan');});
 it("routes the signed-in workspace owner to the customer billing request instead of Platform Admin",async()=>{fixture.authenticated=true;const markup=await render();expect(markup).toContain('href="/billing?plan=manual-plan"');expect(markup).not.toContain('/platform/subscriptions');expect(markup).not.toContain(translate("en","pricing.currentPlan"));expect(markup).not.toContain('/api/billing/checkout');});
 it("keeps public pricing usable to other members without granting them a billing mutation route",async()=>{fixture.authenticated=true;fixture.role="admin";const markup=await render();expect(markup).toContain('href="/dashboard"');expect(markup).not.toContain('href="/billing?plan=manual-plan"');});
 it.each(["expired","suspended"])("never marks a %s subscription current",async status=>{fixture.authenticated=true;fixture.status=status;const markup=await render();expect(markup).not.toContain(translate("en","pricing.currentPlan"));});
 it("hides technical infrastructure limits in Arabic while preserving monthly jobs",async()=>{fixture.locale="ar";document.cookie="yaseir_locale=ar; path=/";const markup=await render();expect(markup).toContain(translate("ar","v4.pricing.unlimitedDevices"));expect(markup).toContain(translate("ar","v4.pricing.jobsPerMonth"));expect(markup).not.toMatch(/max_agents|max_printers|max_jobs_per_minute|max_concurrent_jobs|Stripe|v4\.pricing\./);});
});
