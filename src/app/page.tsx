import { sessionCookieName } from "../lib/session-config";
import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { db } from "../db";
import { plans, tenantSubscriptions, tenants } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireActiveTenantInTransaction, TenantSuspendedError, TenantDeletedError } from "../lib/tenant-guard";
import { requireManagerActorInTransaction, ManagerMutationAuthorityChangedError } from "../lib/manager-mutation-authorization";
import { ThemeToggle } from "../components/ThemeToggle";
import { MobileNavigation } from "../components/marketing/MobileNavigation";
import { CinematicVideo } from "../components/marketing/CinematicVideo";
import { LandingMotion } from "../components/marketing/LandingMotion";
import { SpotlightSurface } from "../components/marketing/SpotlightSurface";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import {
  ArrowRight,
  ChevronRight,
  CreditCard,
  FileText,
  KeyRound,
  Layers,
  LayoutDashboard,
  Printer,
  Users,
} from "lucide-react";
import { BrandMark } from "../components/brand";
import {
  getManagerCookieName,
  verifyWorkspaceTokenFromCookieValues,
} from "../lib/manager-auth";
import { hasManagerPermission } from "../lib/authorization";
import { customerSubscriptionState } from "../lib/manual-subscriptions";
import { databaseNowMs } from "../lib/database-clock";
import { roleLabel } from "../lib/roles";
import { Button, StatusBadge, type Tone } from "../components/ui";
import { getServerLocale, makeT } from "../i18n/server";
import { formatManualCalendarDate } from "../lib/manual-calendar-date";
import type { Locale } from "../i18n/config";
import type { Translator } from "../i18n/translate";

export const dynamic = "force-dynamic";

export default async function Home() {
  const locale = await getServerLocale();
  const t = makeT(locale);
  const cookieStore = await cookies();
  const claims = await verifyWorkspaceTokenFromCookieValues(
    cookieStore.get(sessionCookieName("customer"))?.value ?? null,
    cookieStore.get(getManagerCookieName())?.value ?? null,
  );

  if (claims) {
    const view = await (async () => {
      try {
        const { tenant, subscription, canBilling, plan } = await db.transaction(async tx => {
          await requireActiveTenantInTransaction(tx, claims.tenantId);
          await requireManagerActorInTransaction(tx, claims, "tenant.read");
          const [tenant, subscription] = await Promise.all([
            tx.query.tenants.findFirst({
              where: eq(tenants.id, claims.tenantId),
              columns: { name: true, lifecycle: true },
            }),
            tx.query.tenantSubscriptions.findFirst({
              where: eq(tenantSubscriptions.tenantId, claims.tenantId),
              columns: { planId: true, status: true, currentPeriodStart: true, currentPeriodEnd: true, entitlementBlocked: true },
            }),
          ]);
          const canBilling = hasManagerPermission(claims, "billing.read");
          const plan = canBilling && subscription
            ? await tx.query.plans.findFirst({
                where: eq(plans.id, subscription.planId),
                columns: { name: true },
              })
            : null;
          return { tenant, subscription, canBilling, plan };
        });
        const subscriptionStatus = customerSubscriptionState(subscription, tenant?.lifecycle, await databaseNowMs());
        return { tenant, subscription, canBilling, plan, subscriptionStatus };
      } catch (error) {
        if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError ||
            error instanceof ManagerMutationAuthorityChangedError) {
          return null;
        }
        throw error;
      }
    })();
    if (view) {
      const { tenant, subscription, canBilling, plan, subscriptionStatus } = view;
      return (
        <AuthenticatedHome
          t={t}
          locale={locale}
          tenantName={tenant?.name ?? t("home.authWorkspace")}
          role={claims.role}
          planName={plan?.name ?? null}
          subscriptionStatus={subscriptionStatus}
          periodEnd={canBilling ? subscription?.currentPeriodEnd ?? null : null}
          canBilling={canBilling}
          canTeam={hasManagerPermission(claims, "users.read")}
        />
      );
    }
  }

  return <PublicHome t={t} locale={locale} />;
}

/* ============================================================
   Public landing — original sections with product videos alongside copy.
   ============================================================ */

function PublicHome({ t, locale }: { t: Translator; locale: Locale }) {
  return (
    <div data-yw-marketing className="yw-marketing yw-public-site overflow-x-clip bg-app">
      <LandingMotion />
      <PublicHeader t={t} />

      <main id="main-content">
        {/* ============================================================
            1. HERO: Value proposition with product video
            ============================================================ */}
        <section className="yw-hero ambient-surface relative isolate overflow-hidden border-b border-edge-subtle bg-app pt-12 pb-16 sm:pt-16 sm:pb-24 lg:pt-20 lg:pb-28">
          <div className="yw-hero-inner mx-auto grid w-full max-w-[1280px] items-center gap-10 px-5 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 xl:gap-16 lg:px-10">
            <div className="relative z-10 max-w-[620px]">
              <p data-yw-intro className="yw-hero-eyebrow text-eyebrow">
                {t("home.heroEyebrow")}
              </p>
              <h1
                data-yw-intro
                className="yw-hero-title mt-5 text-[clamp(2.5rem,5vw,4.75rem)] font-[720] leading-[1.06] tracking-[-0.05em] text-ink"
              >
                {t("home.heroTitle1")}
                <br className="hidden sm:block" /> {t("home.heroTitle2")}
              </h1>
              <p data-yw-intro className="mt-5 text-lg leading-[1.7] text-ink-2">
                {t("home.heroBody")}
              </p>

              <div data-yw-intro className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button
                  variant="primary"
                  size="lg"
                  href="/signup"
                  icon={<ArrowRight className="h-4 w-4 rtl:-scale-x-100" />}
                >
                  {t("home.ctaPrimary")}
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  href="#how-it-works"
                  icon={<ChevronRight className="h-4 w-4 rtl:-scale-x-100" />}
                >
                  {t("home.heroSecondary")}
                </Button>
              </div>
            </div>

            <div data-yw-hero-video className="relative">
              <div
                className="pointer-events-none absolute -inset-4 -z-10 rounded-3xl bg-radial from-brand/15 via-brand/5 to-transparent blur-2xl opacity-70"
                aria-hidden="true"
              />
              <CinematicVideo
                mp4Src="/videos/yaseir-pos-scrub-1080p.mp4"
                posterSrc="/videos/yaseir-pos-poster.webp"
                title={t("home.heroVideoA11yTitle")}
                className="yw-hero-video rounded-2xl border border-edge shadow-xl"
              />
            </div>
          </div>
        </section>

        {/* Product overview: video and concise platform capabilities share one section. */}
        <section id="product" className="scroll-mt-20 border-b border-edge-subtle bg-surface py-14 sm:py-20">
          <div className="mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-10">
            <div className="grid items-center gap-8 lg:grid-cols-12 lg:gap-12">
              <div data-yw-reveal className="relative order-2 lg:col-span-7 lg:order-1">
                <div
                  className="pointer-events-none absolute -inset-4 -z-10 rounded-3xl bg-radial from-brand/10 via-brand/5 to-transparent blur-2xl opacity-70"
                  aria-hidden="true"
                />
                <CinematicVideo
                  mp4Src="/videos/yaseir-a4-scrub-1080p.mp4"
                  posterSrc="/videos/yaseir-a4-poster.webp"
                  title={t("home.productShowcaseA11yTitle")}
                  className="rounded-2xl border border-edge shadow-xl"
                />
              </div>

              <div data-yw-reveal className="order-1 max-w-[620px] lg:col-span-5 lg:order-2">
                <p className="text-eyebrow">{t("home.productShowcaseEyebrow")}</p>
                <h2 className="mt-3 text-3xl font-[720] tracking-[-0.03em] text-ink sm:text-4xl">
                  {t("home.productShowcaseTitle")}
                </h2>
              </div>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:mt-10 lg:grid-cols-3">
              <CapabilityCard
                icon={<FileText className="h-5 w-5 text-brand" />}
                title={t("home.capability1Title")}
                lead={t("home.capability1Text")}
              />
              <CapabilityCard
                icon={<Printer className="h-5 w-5 text-brand" />}
                title={t("home.capability2Title")}
                lead={t("home.capability2Text")}
              />
              <CapabilityCard
                icon={<Layers className="h-5 w-5 text-brand" />}
                title={t("home.capability3Title")}
                lead={t("home.capability3Text")}
              />
            </div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-20 border-b border-edge-subtle bg-app py-14 sm:py-20">
          <div className="mx-auto grid w-full max-w-[1280px] gap-8 px-5 sm:px-8 lg:grid-cols-[0.75fr_1.25fr] lg:items-start lg:gap-14 lg:px-10">
            <div data-yw-reveal className="max-w-[480px]">
              <p className="text-eyebrow">{t("home.flowEyebrow")}</p>
              <h2 className="mt-3 text-3xl font-[720] tracking-[-0.03em] text-ink sm:text-4xl">
                {t("home.flowTitle")}
              </h2>
            </div>

            <div className="grid gap-x-8 gap-y-7 border-t border-edge-subtle pt-6 sm:grid-cols-2 lg:border-s lg:border-t-0 lg:ps-8 lg:pt-0">
              <FlowStep
                number="01"
                title={t("home.visualStep1Title")}
                text={t("home.flow1Text")}
              />
              <FlowStep
                number="02"
                title={t("home.visualStep2Title")}
                text={t("home.flow2Text")}
              />
              <FlowStep
                number="03"
                title={t("home.visualStep3Title")}
                text={t("home.flow3Text")}
              />
              <FlowStep
                number="04"
                title={t("home.visualStep4Title")}
                text={t("home.flow4Text")}
              />
            </div>
          </div>
        </section>

        <section className="bg-surface py-12 sm:py-16">
          <div className="mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-10">
            <div data-yw-reveal className="brand-hairline grid gap-6 rounded-2xl border border-edge bg-app p-6 sm:p-9 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-10">
              <div className="max-w-[680px]">
                <h2 className="text-2xl font-[750] leading-[1.12] tracking-[-0.03em] text-ink sm:text-3xl">
                  {t("home.ctaTitle")}
                </h2>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button variant="primary" size="lg" href="/signup" icon={<ArrowRight className="h-4 w-4 rtl:-scale-x-100" />}>
                  {t("home.ctaPrimary")}
                </Button>
                <Button variant="secondary" size="lg" href="/pricing" icon={<ChevronRight className="h-4 w-4 rtl:-scale-x-100" />}>
                  {t("home.ctaSecondary")}
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Sleek Minimal Footer */}
        <footer className="border-t border-edge-subtle bg-surface py-10">
          <div className="mx-auto flex w-full max-w-[1280px] flex-col items-center justify-between gap-6 px-5 sm:flex-row sm:px-8 lg:px-10">
            <div className="flex items-center gap-3">
              <BrandMark title="Yaseir" subtitle="Print Manager" size="sm" showWordmark />
            </div>
            <div className="flex items-center gap-5 text-xs text-ink-3">
              <Link href="/pricing" className="hover:text-ink transition-colors">{t("home.navPricing")}</Link>
              <Link href="/login" className="hover:text-ink transition-colors">{t("auth.signIn.submit")}</Link>
              <span>© {new Date().getFullYear()} Yaseir</span>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

function PublicHeader({ t }: { t: Translator }) {
  return (
    <header className="yw-public-header sticky top-0 z-40 border-b border-edge">
      <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center gap-3 px-4 sm:px-6 lg:h-16 lg:px-8">
        <Link href="/" aria-label={t("home.brandAria")} className="shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30">
          <BrandMark title="Yaseir" subtitle="Print Manager" size="sm" showWordmark className="yw-public-brand-mark" />
        </Link>
        <nav aria-label={t("home.primaryNavigation")} className="ms-auto hidden flex-nowrap items-center gap-0.5 xl:flex">
          <a href="#how-it-works" className="yw-public-nav-link">{t("home.navHowItWorks")}</a>
          <a href="#product" className="yw-public-nav-link">{t("home.productEyebrow")}</a>
          <Link href="/pricing" className="yw-public-nav-link">{t("home.navPricing")}</Link>
        </nav>
        <div className="ms-auto hidden shrink-0 items-center gap-2 xl:flex">
          <Link href="/login" className="yw-public-nav-link">{t("auth.signIn.submit")}</Link>
          <LanguageSwitcher compact placement="below" />
          <ThemeToggle />
          <Button variant="primary" size="sm" href="/signup" className="whitespace-nowrap">{t("home.ctaPrimary")}</Button>
        </div>
        <div className="ms-auto flex shrink-0 items-center gap-2 xl:hidden">
          <Button variant="primary" size="sm" href="/signup" className="whitespace-nowrap max-[399px]:px-3 max-[399px]:text-xs">{t("home.ctaPrimary")}</Button>
          <MobileNavigation
            menuLabel={t("home.navMenu")}
            closeLabel={t("ui.closeDialog")}
            languageLabel={t("common.language")}
            items={[
              { href: "#how-it-works", label: t("home.navHowItWorks") },
              { href: "#product", label: t("home.productEyebrow") },
              { href: "/pricing", label: t("home.navPricing") },
              { href: "/login", label: t("auth.signIn.submit") },
            ]}
          />
        </div>
      </div>
    </header>
  );
}

function FlowStep({
  number,
  title,
  text,
}: {
  number: string;
  title: string;
  text: string;
}) {
  return (
    <div data-yw-flow-step className="space-y-2">
      <span className="font-mono text-xs font-semibold tabular text-brand">
        {number}
      </span>
      <h3 className="text-base font-[650] text-ink">{title}</h3>
      <p className="text-xs leading-relaxed text-ink-2 sm:text-sm">{text}</p>
    </div>
  );
}

function CapabilityCard({
  icon,
  title,
  lead,
}: {
  icon: ReactNode;
  title: string;
  lead: string;
}) {
  return (
    <SpotlightSurface className="yw-editorial-card rounded-2xl border border-edge bg-surface p-6 sm:p-7">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-brand/20 bg-brand-subtle text-brand">
        {icon}
      </span>
      <h3 className="mt-4 text-base font-[650] text-ink sm:text-lg">{title}</h3>
      <p className="mt-2 text-xs leading-relaxed text-ink-2 sm:text-sm">{lead}</p>
    </SpotlightSurface>
  );
}

/* ============================================================
   Signed-in landing (Preserved completely intact)
   ============================================================ */

function AuthenticatedHome({
  t,
  locale,
  tenantName,
  role,
  planName,
  subscriptionStatus,
  periodEnd,
  canBilling,
  canTeam,
}: {
  t: Translator;
  locale: Locale;
  tenantName: string;
  role: string;
  planName: string | null;
  subscriptionStatus: ReturnType<typeof customerSubscriptionState>;
  periodEnd: Date | null;
  canBilling: boolean;
  canTeam: boolean;
}) {
  const hasPlan = !!planName && subscriptionStatus === "active";
  const statusTone: Tone = subscriptionStatus === "active" ? "ok" : subscriptionStatus === "suspended" ? "bad" : "warn";
  const statusKey = {
    active: "v4.onboarding.active",
    awaiting_activation: "v4.onboarding.pending",
    expired: "v4.onboarding.expired",
    suspended: "v4.onboarding.suspended",
  } as const;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-9 sm:px-8">
      <section className="card overflow-hidden">
        <div className="flex flex-col gap-5 px-6 py-6 sm:flex-row sm:items-start sm:justify-between sm:px-7">
          <div className="min-w-0">
            <p className="text-eyebrow">{t("home.authWorkspace")}</p>
            <h1 className="mt-2 text-3xl font-[660] tracking-[-0.03em] text-ink">{tenantName}</h1>
            <p className="mt-1.5 text-base text-ink-2">
              {t("home.authSignedInAs")} <span className="font-[600] text-ink">{roleLabel(role, t)}</span>
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="primary" href="/dashboard" icon={<ArrowRight className="h-4 w-4 rtl:-scale-x-100" />}>
              {t("home.authOpenConsole")}
            </Button>
            {canBilling && (
              <Button variant="secondary" href="/billing" icon={<CreditCard className="h-4 w-4" />}>
                {t("v4.subscription.title")}
              </Button>
            )}
          </div>
        </div>

        <dl className={`grid grid-cols-1 divide-y divide-edge-subtle border-t border-edge-subtle ${canBilling ? "sm:grid-cols-3 sm:divide-x sm:divide-y-0" : ""}`}>
          {canBilling && <div className="px-6 py-4">
            <dt className="label-caps">{t("home.planLabel")}</dt>
            <dd className="mt-1.5 text-sm font-[600] text-ink">{hasPlan ? planName : t("billing.noPlanSelected")}</dd>
          </div>}
          <div className="px-6 py-4">
            <dt className="label-caps">{t("home.subscriptionLabel")}</dt>
            <dd className="mt-1.5">
              <StatusBadge
                tone={statusTone}
                label={t(statusKey[subscriptionStatus])}
              />
            </dd>
          </div>
          {canBilling && <div className="px-6 py-4">
            <dt className="label-caps">{t("v4.subscription.end")}</dt>
            <dd className="mt-1.5 text-sm font-[600] text-ink">
              {formatManualCalendarDate(periodEnd, locale) ?? t("common.notAvailable")}
            </dd>
          </div>}
        </dl>
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-3">
        <QuickLink
          href="/dashboard"
          icon={<LayoutDashboard className="h-4 w-4" />}
          title={t("nav.console")}
          text={t("home.quickDashboard")}
          meta={hasPlan ? planName ?? "" : t("home.quickDashboardMeta")}
          t={t}
        />
        <QuickLink
          href="/api-keys"
          icon={<KeyRound className="h-4 w-4" />}
          title={t("home.quickOdooTitle")}
          text={t("home.quickOdooText")}
          meta={t("home.quickOdooMeta")}
          t={t}
        />
        {canTeam ? (
          <QuickLink
            href="/team"
            icon={<Users className="h-4 w-4" />}
            title={t("home.quickTeamTitle")}
            text={t("home.quickTeamText")}
            meta={t("home.quickTeamMeta")}
            t={t}
          />
        ) : (
          <QuickLink
            href="/settings"
            icon={<Printer className="h-4 w-4" />}
            title={t("home.quickSettingsTitle")}
            text={t("home.quickSettingsText")}
            meta={t("home.quickSettingsMeta")}
            t={t}
          />
        )}
      </section>
    </div>
  );
}

function QuickLink({
  href,
  icon,
  title,
  text,
  meta,
  t,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  text: string;
  meta: string;
  t: Translator;
}) {
  return (
    <Link href={href} className="card-interactive flex flex-col justify-between p-5">
      <div>
        <div className="flex items-center justify-between">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-edge bg-surface-2 text-brand">
            {icon}
          </span>
          <ArrowRight className="h-4 w-4 text-ink-3 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" />
        </div>
        <h2 className="mt-4 text-base font-[620] tracking-[-0.015em] text-ink">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-2">{text}</p>
      </div>
      <div className="mt-4 border-t border-edge-subtle pt-3">
        <p className="text-2xs text-ink-3">
          <span className="font-medium text-ink-2">{meta}</span>
          {" · "}
          {t("home.quickLinkOpen")}
        </p>
      </div>
    </Link>
  );
}
