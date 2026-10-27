import { cookies } from "next/headers";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { tenantSubscriptions, tenants } from "../../db/schema";
import { customerSubscriptionState } from "../../lib/manual-subscriptions";
import { databaseNowMs } from "../../lib/database-clock";
import { formatPlanPriceDisplay } from "../../lib/plan-price";
import { ArrowRight, Check } from "lucide-react";
import { db } from "../../db";
import { plans } from "../../db/schema";
import { sessionCookieName } from "../../lib/session-config";
import { getManagerCookieName, verifyWorkspaceTokenFromCookieValues } from "../../lib/manager-auth";
import { getServerLocale, makeT } from "../../i18n/server";
import { formatNumber } from "../../i18n/format";
import { Button, Callout, Card } from "../../components/ui";
import { BrandMark } from "../../components/brand";
import { ThemeToggle } from "../../components/ThemeToggle";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { logError } from "../../lib/log";

export const dynamic = "force-dynamic";

export default async function Pricing() {
  const locale = await getServerLocale();
  const t = makeT(locale);
  let rows: Array<{ id: string; name: string; description: string | null; priceMinorUnits: number | null; priceCurrency: string | null; entitlements: Record<string, unknown> }> = [];
  const jar = await cookies();
  const claims = await verifyWorkspaceTokenFromCookieValues(jar.get(sessionCookieName("customer"))?.value ?? null,jar.get(getManagerCookieName())?.value ?? null);
  if (claims) {
    const [sub,tenant,now] = await Promise.all([db.query.tenantSubscriptions.findFirst({where:eq(tenantSubscriptions.tenantId,claims.tenantId)}),db.query.tenants.findFirst({where:eq(tenants.id,claims.tenantId),columns:{lifecycle:true}}),databaseNowMs()]);
    if (customerSubscriptionState(sub,tenant?.lifecycle,now)==="active") redirect(claims.role==="owner"?"/billing":"/dashboard");
  }
  let unavailable = false;
  try {
    rows = await db.select({ id: plans.id, name: plans.name, description: plans.description, priceMinorUnits: plans.priceMinorUnits, priceCurrency: plans.priceCurrency, entitlements: plans.entitlements })
      .from(plans).where(and(eq(plans.isActive, true), eq(plans.isPublic, true))).orderBy(asc(plans.displayOrder), asc(plans.name));
  } catch {
    unavailable = true;
    logError("pricing.catalog_load_failed", { error: "Public catalog unavailable" });
  }
  // An inactive workspace can request access; an active one sees its contract.
  const destination = (planId: string) => claims?.role === "owner"
    ? `/billing?plan=${encodeURIComponent(planId)}`
    : claims ? "/dashboard" : `/signup?plan=${encodeURIComponent(planId)}`;


  return <div className="min-h-screen bg-app">
    <header className="border-b border-edge-subtle bg-surface">
      <div className="mx-auto grid max-w-[1200px] grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex sm:min-h-[76px] sm:gap-5 sm:px-6 lg:px-8">
        <Link href="/" className="inline-flex min-w-0 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35">
          <BrandMark title="Yaseir" size="sm" showWordmark />
        </Link>
        <div className="col-start-2 row-start-1 flex items-center gap-0 sm:ms-auto">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
        <nav className="col-span-2 flex w-full items-center gap-2 sm:w-auto" aria-label={t("pricing.navAria")}>
          {claims
            ? <Button href="/dashboard" variant="secondary" size="sm" className="min-h-10 w-full whitespace-nowrap px-4 sm:w-auto">
                {t("pricing.openConsole")}
              </Button>
            : <>
                <Button href="/login" variant="secondary" size="sm" className="min-h-10 flex-1 whitespace-nowrap px-4 sm:flex-none sm:px-5">
                  {t("pricing.signIn")}
                </Button>
                <Button href="/signup" variant="primary" size="sm" className="min-h-10 flex-1 whitespace-nowrap px-4 sm:flex-none sm:px-5">
                  {t("pricing.getStarted")}
                </Button>
              </>}
        </nav>
      </div>
    </header>
    <main className="mx-auto max-w-[1200px] px-4 pb-20 pt-10 sm:px-6 sm:pt-14 lg:px-8">
      <header className="mb-8 max-w-3xl sm:mb-10">
        <h1 className="text-[clamp(1.875rem,3vw,2.5rem)] font-[700] leading-tight tracking-tight text-ink">{t("v4.pricing.title")}</h1>
      </header>
      {unavailable
        ? <Callout tone="warn" title={t("pricing.catalogUnavailableTitle")}>{t("pricing.catalogUnavailableBody")}
            <div className="mt-3"><Button href="/pricing" variant="secondary">{t("pricing.retry")}</Button></div>
          </Callout>
        : rows.length === 0
          ? <Callout tone="info" title={t("pricing.noPlansTitle")}>{t("pricing.noPlansBody")}</Callout>
          : <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {rows.map(plan => {
                const price = formatPlanPriceDisplay(plan.priceMinorUnits, plan.priceCurrency, locale);
                const monthlyQuota = plan.entitlements.max_prints_per_period;
                return <Card key={plan.id} className="flex h-full flex-col overflow-hidden rounded-2xl border border-edge-subtle shadow-sm">
                  <div className="flex-1 px-6 pb-6 pt-7 sm:px-7">
                    <div className="min-h-[4.5rem]">
                      <h2 className="break-words text-[1.375rem] font-[650] leading-snug tracking-tight text-ink">{plan.name}</h2>
                      {plan.description && <p className="mt-2 break-words text-sm leading-6 text-ink-3">{plan.description}</p>}
                    </div>
                    <div className="mt-4 min-h-[5.5rem]">
                      {price ? <>
                        <p className="text-xs font-medium text-ink-3">{t("v4.pricing.publishedPrice")}</p>
                        <div className="mt-1.5 inline-flex max-w-full items-baseline gap-2" dir="ltr">
                          <span className="text-[clamp(1.875rem,2.6vw,2.375rem)] font-[700] leading-tight tracking-[-0.035em] tabular-nums text-ink">{price.amount}</span>
                          <span className="text-sm font-[600] tracking-wide text-ink-3">{price.currency}</span>
                        </div>
                      </> : <p className="pt-6 text-base font-[600] text-ink-2">{t("v4.pricing.priceOnRequest")}</p>}
                    </div>
                    <div className="mt-5 border-t border-edge-subtle pt-5">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        {typeof monthlyQuota === "number"
                          ? <span className="text-xl font-[650] tabular-nums text-ink-2"><bdi dir="ltr">{formatNumber(monthlyQuota, locale)}</bdi></span>
                          : <span className="text-xl font-[650] text-ink-2">{t("billing.unlimited")}</span>}
                        <span className="text-sm leading-6 text-ink-3">{t("v4.pricing.jobsPerMonth")}</span>
                      </div>
                    </div>
                    <ul className="mt-6 space-y-3 border-t border-edge-subtle pt-6 text-sm leading-6 text-ink-2">
                      {(["v4.pricing.featureOdoo", "v4.pricing.featurePos", "v4.pricing.featureBranches", "v4.pricing.featureActivity"] as const).map(key =>
                        <li key={key} className="flex items-start gap-3">
                          <Check className="mt-1 h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
                          <span>{t(key)}</span>
                        </li>)}
                    </ul>
                  </div>
                  <div className="mt-auto border-t border-edge-subtle px-6 py-5 sm:px-7">
                    <Button href={destination(plan.id)} variant="primary" appearance="outline" size="md" className="w-full" icon={<ArrowRight className="h-4 w-4 rtl:-scale-x-100" />}>
                      {t(!claims || claims.role === "owner" ? "pricing.chooseThisPlan" : "pricing.openConsole")}
                    </Button>
                  </div>
                </Card>;
              })}
            </div>}
    </main>
  </div>;
}
