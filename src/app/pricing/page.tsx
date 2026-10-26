import { cookies } from "next/headers";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { Check, ArrowRight } from "lucide-react";
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
  const locale = await getServerLocale(); const t = makeT(locale);
  let rows: Array<{ id: string; name: string; description: string | null; entitlements: Record<string, unknown> }> = [];
  let unavailable = false;
  try {
    rows = await db.select({ id: plans.id, name: plans.name, description: plans.description, entitlements: plans.entitlements })
      .from(plans).where(and(eq(plans.isActive,true),eq(plans.isPublic,true))).orderBy(asc(plans.displayOrder),asc(plans.name));
  } catch { unavailable = true; logError("pricing.catalog_load_failed", { error: "Public catalog unavailable" }); }
  const jar = await cookies();
  const claims = await verifyWorkspaceTokenFromCookieValues(jar.get(sessionCookieName("customer"))?.value ?? null, jar.get(getManagerCookieName())?.value ?? null);
  // Public catalog is not the current workspace subscription; never personalize it for workspace users.
  const destination = (planId: string) => claims ? "/dashboard" : `/signup?plan=${encodeURIComponent(planId)}`;
  return <div className="min-h-screen bg-app">
    <header className="border-b border-edge"><div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center gap-3 px-5 py-3"><Link href="/"><BrandMark title="Yaseir" size="sm" showWordmark /></Link><nav className="ms-auto flex flex-wrap items-center gap-2" aria-label={t("pricing.navAria")}><LanguageSwitcher /><ThemeToggle /><Button href={claims ? "/dashboard" : "/login"} variant="secondary">{t(claims ? "pricing.openConsole" : "pricing.signIn")}</Button><Button href={claims ? "/dashboard" : "/signup"} variant="primary">{t(claims ? "pricing.openConsole" : "pricing.getStarted")}</Button></nav></div></header>
    <main className="mx-auto max-w-6xl space-y-8 px-5 py-10 sm:px-8">
      <header className="max-w-3xl space-y-3"><p className="text-eyebrow">{t("v4.pricing.eyebrow")}</p><h1 className="text-4xl font-semibold text-ink">{t("v4.pricing.title")}</h1><p className="text-lg leading-relaxed text-ink-3">{t("v4.pricing.intro")}</p></header>
      {unavailable ? <Callout tone="warn" title={t("pricing.catalogUnavailableTitle")}>{t("pricing.catalogUnavailableBody")}<div className="mt-3"><Button href="/pricing" variant="secondary">{t("pricing.retry")}</Button></div></Callout> : rows.length === 0 ? <Callout tone="info" title={t("pricing.noPlansTitle")}>{t("pricing.noPlansBody")}</Callout> : <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{rows.map(plan => <Card key={plan.id} className="flex flex-col"><div className="flex-1 space-y-4 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{plan.name}</h2></div>{plan.description && <p className="text-sm leading-relaxed text-ink-3">{plan.description}</p>}<p className="text-2xl font-semibold text-brand">{typeof plan.entitlements.max_prints_per_period === "number" ? formatNumber(plan.entitlements.max_prints_per_period,locale) : t("billing.unlimited")}</p><p className="text-sm text-ink-3">{t("v4.pricing.jobsPerMonth")}</p><ul className="space-y-3 text-sm">{["v4.pricing.unlimitedDevices","v4.pricing.unlimitedMembers","v4.pricing.flexibleTerm"].map(key => <li key={key} className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-ok" aria-hidden />{t(key as "v4.pricing.unlimitedDevices" | "v4.pricing.unlimitedMembers" | "v4.pricing.flexibleTerm")}</li>)}</ul></div><div className="space-y-2 border-t border-edge-subtle p-5"><Button href={destination(plan.id)} variant="primary" className="w-full" icon={<ArrowRight className="h-4 w-4 rtl:-scale-x-100" />}>{t(claims ? "pricing.openConsole" : "pricing.chooseThisPlan")}</Button><p className="text-xs leading-relaxed text-ink-3">{t("v4.pricing.contactPrice")}</p></div></Card>)}</div>}
      <Callout tone="info" title={t("v4.onboarding.manualTitle")}>{t("v4.onboarding.manualBody")}</Callout>
      <section className="max-w-3xl space-y-3"><h2 className="text-xl font-semibold">{t("v4.subscription.monthlyUsage")}</h2><p className="leading-relaxed text-ink-3">{t("v4.onboarding.monthlyReset")}</p><p className="text-sm leading-relaxed text-ink-3">{t("v4.pricing.retryPolicy")}</p></section>
    </main>
  </div>;
}
