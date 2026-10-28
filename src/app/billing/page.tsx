import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { CalendarDays, CreditCard } from "lucide-react";
import { db } from "../../db";
import { plans } from "../../db/schema";
import { sessionCookieName } from "../../lib/session-config";
import { getManagerCookieName, verifyWorkspaceTokenFromCookieValues } from "../../lib/manager-auth";
import { hasManagerPermission } from "../../lib/authorization";
import { customerSubscriptionState } from "../../lib/manual-subscriptions";
import { databaseNowMs } from "../../lib/database-clock";
import { activationWhatsAppUrl } from "../../lib/activation-contact";
import { getServerLocale, makeT } from "../../i18n/server";
import { formatNumber } from "../../i18n/format";
import { formatManualCalendarDate } from "../../lib/manual-calendar-date";
import { billingTermLabel } from "../../lib/billing-labels";
import { formatPlanPrice } from "../../lib/plan-price";
import { BillingActions } from "../../components/BillingActions";
import { Button, Callout, Card, CardHeader, PageContainer, PageHeader, Progress, StatusBadge, type Tone } from "../../components/ui";
import { loadOwnerBillingPageSnapshot } from "../../lib/billing-page-snapshot";
import { ManagerMutationAuthorityChangedError } from "../../lib/manager-mutation-authorization";
import { TenantSuspendedError, TenantDeletedError } from "../../lib/tenant-guard";

export const dynamic = "force-dynamic";
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ plan?: string | string[] }> }) {
  const jar = await cookies();
  const claims = await verifyWorkspaceTokenFromCookieValues(jar.get(sessionCookieName("customer"))?.value ?? null, jar.get(getManagerCookieName())?.value ?? null);
  if (!claims) redirect("/login?next=%2Fbilling");
  if (!claims.userId || !hasManagerPermission(claims, "billing.read")) redirect("/dashboard");
  const locale = await getServerLocale(); const t = makeT(locale);
  const params = await searchParams;
  const [availablePlans, now] = await Promise.all([
    db.select({ id: plans.id, name: plans.name, entitlements: plans.entitlements })
      .from(plans).where(and(eq(plans.isActive, true), eq(plans.isPublic, true)))
      .orderBy(asc(plans.displayOrder), asc(plans.name)),
    databaseNowMs(),
  ]);
  let snapshot: Awaited<ReturnType<typeof loadOwnerBillingPageSnapshot>>;
  try {
    // SSR is a data disclosure boundary too. Cookie preflight alone must not
    // expose the former owner's contract after a logout, role downgrade or
    // workspace suspension. The snapshot keeps the current authority locks
    // held until its subscription, history and monthly-usage reads finish.
    snapshot = await loadOwnerBillingPageSnapshot(claims);
  } catch (error) {
    if (error instanceof ManagerMutationAuthorityChangedError) {
      if (error.status === 401) redirect("/login?next=%2Fbilling");
      redirect("/dashboard");
    }
    if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) {
      redirect("/dashboard");
    }
    throw error;
  }
  const { sub, tenant, requests, plan, usage } = snapshot;
  const status = customerSubscriptionState(sub, tenant?.lifecycle, now);
  // Published list price is not the manually agreed price of this subscription.
  const publishedPlanPrice = sub?.subscriptionType === "paid" && plan
    ? formatPlanPrice(plan.priceMinorUnits, plan.priceCurrency, locale) : null;
  const statusKey = { active: "v4.onboarding.active", awaiting_activation: "v4.onboarding.pending", expired: "v4.onboarding.expired", suspended: "v4.onboarding.suspended" } as const;
  const tone: Tone = status === "active" ? "ok" : status === "suspended" ? "bad" : "warn";
  const date = (value: Date | null | undefined) => formatManualCalendarDate(value, locale) ?? t("v4.subscription.notSet");
  const resetInstant = (value: Date | null | undefined) => value ? new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", { dateStyle:"medium", timeStyle:"short", timeZone:"UTC" }).format(value) : t("v4.subscription.notSet");
  const quotaExhausted = status === "active" && usage?.remaining === 0;
  const expiringSoon = status === "active" && !!sub?.currentPeriodEnd && sub.currentPeriodEnd.getTime() > now && sub.currentPeriodEnd.getTime() - now <= 7 * 86_400_000;
  const legacyEndMissing = status === "expired" && sub?.status === "active" && sub?.subscriptionType === "paid" && !sub.currentPeriodEnd;
  const request = requests[0];
  const selectedPlanId = typeof params.plan === "string" ? params.plan : undefined;
  return <>
    <PageHeader title={t("v4.subscription.title")} description={t("v4.subscription.intro")} icon={<CreditCard className="h-4 w-4" />} meta={<StatusBadge tone={tone} label={t(statusKey[status])} />}  />
    <PageContainer><div className="space-y-5">
      {status !== "active" && <Callout tone={tone} title={t(statusKey[status])}>
        <p>{t(status === "expired" ? "v4.subscription.expiredBody" : status === "suspended" ? "v4.subscription.suspendedBody" : "v4.subscription.pendingBody")}</p>
        {claims.role === "owner" && status === "expired" && <div className="mt-3"><Button size="sm" variant="secondary" href="#billing-actions">{t("v4.subscription.renewRequestAction")}</Button></div>}
      </Callout>}
      {quotaExhausted && <Callout tone="warn" title={t("v4.subscription.quotaBlockedTitle")}>
        <p>{t("v4.subscription.quotaBlockedBody")}</p>
        <div className="mt-3"><Button size="sm" variant="secondary" href="#billing-actions">{t("v4.subscription.quotaBlockedAction")}</Button></div>
      </Callout>}
      {!quotaExhausted && expiringSoon && <Callout tone="warn" title={t("v4.subscription.expiringSoonTitle")}>
        <p>{t("v4.subscription.expiringSoonBody", { date: date(sub?.currentPeriodEnd) })}</p>
        <div className="mt-3"><Button size="sm" variant="secondary" href="#billing-actions">{t("v4.subscription.renewRequestAction")}</Button></div>
      </Callout>}
      {legacyEndMissing && <Callout tone="warn" title={t("v4.subscription.legacyEndMissingTitle")}>
        {t("v4.subscription.legacyEndMissingBody")}
      </Callout>}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]"><div className="space-y-5">
        <Card><CardHeader title={t(status === "active" ? "v4.subscription.yourCurrentPlan" : "v4.subscription.recordedContract")} subtitle={t(status === "active" ? "v4.subscription.currentContract" : "v4.subscription.recordedContract")} icon={<CalendarDays className="h-4 w-4" />} /><div className="px-5 pt-4 text-lg font-semibold">{plan?.name ?? t("billing.noPlanSelected")}</div>{publishedPlanPrice && <p className="px-5 pt-2 text-sm text-ink-3">{t("v4.subscription.catalogPrice")}: <bdi dir="auto">{publishedPlanPrice}</bdi></p>}<dl className="grid gap-5 p-5 sm:grid-cols-2">
          {[[t("v4.subscription.type"), t(sub?.subscriptionType === "free" ? "v4.subscription.free" : sub?.subscriptionType === "paid" ? "v4.subscription.paid" : "v4.subscription.notSet")], [t("v4.onboarding.term"), billingTermLabel(sub?.term, t)], [t("v4.subscription.start"), date(sub?.currentPeriodStart)], [t("v4.subscription.end"), date(sub?.currentPeriodEnd)]].map(([label,value]) => <div key={label}><dt className="text-sm text-ink-3">{label}</dt><dd className="mt-1 font-semibold"><bdi dir="auto">{value}</bdi></dd></div>)}
        </dl><p className="border-t border-edge-subtle p-5 text-sm text-ink-3">{t(sub?.cancelAtPeriodEnd ? "v4.subscription.endsAtTerm" : "v4.subscription.manualRenewal")}</p>
        </Card>
        <Card><CardHeader title={t("v4.subscription.monthlyUsage")} />{usage ? <div className="space-y-4 p-5"><dl className="grid gap-4 sm:grid-cols-3">{[[t("v4.subscription.used"),formatNumber(usage.used,locale)],[t("v4.subscription.allowance"),usage.limit === "unlimited" ? t("billing.unlimited") : formatNumber(usage.limit,locale)],[t("v4.subscription.remaining"),usage.remaining === "unlimited" ? t("billing.unlimited") : formatNumber(usage.remaining,locale)]].map(([label,value]) => <div key={label}><dt className="text-sm text-ink-3">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums"><bdi dir="ltr">{value}</bdi></dd></div>)}</dl>{usage.limit !== "unlimited" && <Progress value={Math.min(100,usage.used / Math.max(1,usage.limit)*100)} tone={usage.remaining === 0 ? "bad" : "brand"} label={t("billing.usageAria", { used: formatNumber(usage.used,locale), limit: formatNumber(usage.limit,locale) })} />}<p className="text-sm text-ink-3">{t("v4.subscription.nextReset", { date: resetInstant(usage.reset) })}</p>{status !== "active" && <p className="text-sm text-ink-3">{t("v4.subscription.balanceNotAccess")}</p>}<p className="text-xs text-ink-3">{t("v4.subscription.renewalDoesNotReset")}</p></div> : <p className="p-5 text-sm text-ink-3">{t(sub ? "billing.usageUnavailableBody" : "v4.subscription.noAllowance")}</p>}</Card>
        
      </div><Card><div className="p-5"><BillingActions key={`${selectedPlanId ?? ""}:${request?.id ?? "none"}:${request?.status ?? "none"}`} plans={availablePlans} selectedPlanId={selectedPlanId} currentPlanId={sub?.planId} currentTerm={sub?.term} isOwner={claims.role === "owner"} status={status} initialRequest={request ? { id:request.id,reference:request.id,status:request.status,planId:request.planId,term:request.term,requestedMonthlyQuota:request.requestedMonthlyQuota,approvalModified:request.approvalModified,approvedPlanId:request.approvedPlanId,approvedTerm:request.approvedTerm,approvedMonthlyQuota:request.approvedMonthlyQuota,createdAt:request.createdAt.toISOString(),whatsappUrl:activationWhatsAppUrl(request.id) } : null} /></div></Card></div>
    </div></PageContainer>
  </>;
}
