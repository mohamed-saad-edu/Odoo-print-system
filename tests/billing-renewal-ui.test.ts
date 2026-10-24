// @vitest-environment jsdom
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../src/i18n/react";
import { formatNumber } from "../src/i18n/format";
import { translate } from "../src/i18n/translate";
const fixture=vi.hoisted(()=>({locale:"en" as "en"|"ar",subscription:{} as Record<string,unknown>,role:"owner",used:80}));
vi.mock("next/headers",()=>({cookies:async()=>({get:(name:string)=>({value:name==="yaseir_locale"?fixture.locale:"session"})})}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()}),redirect:(path:string)=>{throw new Error(`redirect:${path}`);}}));
vi.mock("next/link",()=>({default:({children,...props}:Record<string,unknown>)=>h("a",props,children as ReactNode)}));
vi.mock("../src/lib/manager-auth",()=>({getManagerCookieName:()=>"mgr_session",verifyWorkspaceTokenFromCookieValues:async()=>({role:fixture.role,tenantId:"tenant"})}));
vi.mock("../src/lib/database-clock",()=>({databaseNowMs:async()=>Date.parse("2030-05-15T00:00:00Z")}));
vi.mock("../src/db",()=>({db:{query:{tenantSubscriptions:{findFirst:async()=>fixture.subscription},tenants:{findFirst:async()=>({lifecycle:"active"})},subscriptionRequests:{findMany:async()=>[]},plans:{findFirst:async()=>({name:"Annual plan",entitlements:{max_agents:"unlimited",max_printers:"unlimited",max_prints_per_period:200,max_jobs_per_minute:60,max_concurrent_jobs:20}})}},select:()=>({from:()=>({where:()=>({orderBy:async()=>[{id:"p1",name:"Annual plan",entitlements:{max_prints_per_period:200}}]})})}),execute:async()=>({rows:[{used:fixture.used,reset:"2030-06-01T00:00:00Z"}]})}}));
import BillingPage from "../src/app/billing/page";
beforeEach(()=>{localStorage.clear();fixture.role="owner";fixture.used=80;fixture.subscription={tenantId:"tenant",planId:"p1",status:"active",billingMode:"manual",monthlyQuota:100,subscriptionType:"paid",term:"yearly",currentPeriodStart:new Date("2030-01-01T00:00:00Z"),currentPeriodEnd:new Date("2031-01-01T00:00:00Z"),cancelAtPeriodEnd:false};});
async function render(locale:"en"|"ar"){fixture.locale=locale;document.cookie=`yaseir_locale=${locale}; path=/`;const element=await BillingPage({searchParams:Promise.resolve({plan:"p1"})});return renderToStaticMarkup(h(I18nProvider,{initialLocale:locale,children:element}));}
describe("manual billing status and independent monthly usage",()=>{
  it.each(["en","ar"] as const)("shows truthful annual contract and independent monthly allowance in %s",async locale=>{
    const markup=await render(locale);expect(markup).toContain(translate(locale,"v4.subscription.manualRenewal"));expect(markup).toContain(translate(locale,"v4.onboarding.yearly"));expect(markup).not.toMatch(/Stripe|checkout|billingActions\./);
    const doc=new DOMParser().parseFromString(markup,"text/html");const label=[...doc.querySelectorAll("dt")].find(node=>node.textContent===translate(locale,"v4.subscription.allowance"));expect(label?.nextElementSibling?.textContent).toBe(formatNumber(100,locale));
    expect(markup).toContain(translate(locale,"v4.subscription.unlimitedBody"));
  });
  it("expired contract retains usage history but never claims printing access",async()=>{fixture.subscription.currentPeriodEnd=new Date("2029-12-31T00:00:00Z");const markup=await render("en");expect(markup).toContain("Subscription expired");expect(markup).toContain(translate("en","v4.subscription.balanceNotAccess"));expect(markup).not.toContain(translate("en","v4.subscription.activeBody"));});
  it("suspended subscription does not become active despite future contract end",async()=>{fixture.subscription.entitlementBlocked=true;const markup=await render("en");expect(markup).toContain(translate("en","v4.subscription.suspendedBody"));expect(markup).not.toContain(translate("en","v4.subscription.activeBody"));});
  it("scheduled contract ending never claims automatic renewal",async()=>{fixture.subscription.cancelAtPeriodEnd=true;expect(await render("en")).toContain(translate("en","v4.subscription.endsAtTerm"));});
  it("Full Access can read contract but has no request form",async()=>{fixture.role="admin";const markup=await render("en");expect(markup).toContain(translate("en","v4.subscription.ownerBody"));expect(markup).not.toContain('id="request-plan"');});
});
