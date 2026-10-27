import { cookies } from "next/headers";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
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
  let rows: Array<{ id: string; name: string; description: string | null; entitlements: Record<string, unknown> }> = [];
  let unavailable = false;
  try {
    rows = await db.select({ id: plans.id, name: plans.name, description: plans.description, entitlements: plans.entitlements })
      .from(plans).where(and(eq(plans.isActive, true), eq(plans.isPublic, true))).orderBy(asc(plans.displayOrder), asc(plans.name));
  } catch {
    unavailable = true;
    logError("pricing.catalog_load_failed", { error: "Public catalog unavailable" });
  }
  const jar = await cookies();
  const claims = await verifyWorkspaceTokenFromCookieValues(
    jar.get(sessionCookieName("customer"))?.value ?? null,
    jar.get(getManagerCookieName())?.value ?? null,
  );
  // Public catalog never claims to be the customer's existing subscription.
  const destination = (planId: string) => claims?.role === "owner"
    ? `/billing?plan=${encodeURIComponent(planId)}`
    : claims ? "/dashboard" : `/signup?plan=${encodeURIComponent(planId)}`;

  return <div className="min-h-screen bg-app">
    <header className="border-b border-edge">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-3 px-5 py-3">
        <Link href="/"><BrandMark title="Yaseir" size="sm" showWordmark /></Link>
        <nav className="flex items-center gap-2" aria-label={t("pricing.navAria")}>
          <LanguageSwitcher /><ThemeToggle />
          {claims
            ? <Button href="/dashboard" variant="secondary">{t("pricing.openConsole")}</Button>
            : <><Button href="/login" variant="secondary">{t("pricing.signIn")}</Button>
                <Button href="/signup" variant="primary">{t("pricing.getStarted")}</Button></>}
        </nav>
      </div>
    </header>
    <main className="mx-auto max-w-6xl space-y-7 px-5 py-10 sm:px-8">
      <header className="max-w-3xl space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t("v4.pricing.title")}</h1>
      </header>
      {unavailable
        ? <Callout tone="warn" title={t("pricing.catalogUnavailableTitle")}>{t("pricing.catalogUnavailableBody")}
            <div className="mt-3"><Button href="/pricing" variant="secondary">{t("pricing.retry")}</Button></div>
          </Callout>
        : rows.length === 0
          ? <Callout tone="info" title={t("pricing.noPlansTitle")}>{t("pricing.noPlansBody")}</Callout>
          : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rows.map(plan => <Card key={plan.id} className="flex h-full flex-col">
                <div className="flex-1 space-y-4 p-5">
                  <h2 className="text-xl font-semibold">{plan.name}</h2>
                  {plan.description && <p className="text-sm text-ink-3">{plan.description}</p>}
                  <div>
                    <p className="text-3xl font-semibold tabular-nums text-brand"><bdi dir="ltr">{typeof plan.entitlements.max_prints_per_period === "number"
                      ? formatNumber(plan.entitlements.max_prints_per_period, locale)
                      : t("billing.unlimited")}</bdi></p>
                    <p className="mt-1 text-sm text-ink-3">{t("v4.pricing.jobsPerMonth")}</p>
                  </div>
                  <ul className="space-y-3 border-t border-edge-subtle pt-5 text-sm text-ink-2">
                    {(["v4.pricing.featureOdoo", "v4.pricing.featurePos", "v4.pricing.featureBranches", "v4.pricing.featureActivity"] as const).map(key =>
                      <li key={key} className="flex items-start gap-2.5">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                        <span>{t(key)}</span>
                      </li>)}
                  </ul>
                </div>
                <div className="border-t border-edge-subtle p-5">
                  <Button href={destination(plan.id)} variant="primary" className="w-full" icon={<ArrowRight className="h-4 w-4 rtl:-scale-x-100" />}>
                    {t(!claims || claims.role === "owner" ? "pricing.chooseThisPlan" : "pricing.openConsole")}
                  </Button>
                </div>
              </Card>)}
            </div>}
    </main>
  </div>;
}
