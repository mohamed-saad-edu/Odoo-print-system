import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { CalendarDays, CreditCard } from "lucide-react";
import { db } from "../../db";
import { plans, tenantSubscriptions, tenants, subscriptionRequests } from "../../db/schema";
import { sessionCookieName } from "../../lib/session-config";
import { getManagerCookieName, verifyWorkspaceTokenFromCookieValues } from "../../lib/manager-auth";
import { hasManagerPermission } from "../../lib/authorization";
import { customerSubscriptionState } from "../../lib/manual-subscriptions";
import { databaseNowMs } from "../../lib/database-clock";
import { effectiveManualEntitlements } from "../../lib/entitlements";
import { activationWhatsAppUrl } from "../../lib/activation-contact";
import { getServerLocale, makeT } from "../../i18n/server";
import { formatNumber } from "../../i18n/format";
import { formatManualCalendarDate } from "../../lib/manual-calendar-date";
import { billingTermLabel } from "../../lib/billing-labels";
import { BillingActions } from "../../components/BillingActions";
import { Button, Callout, Card, CardHeader, PageContainer, PageHeader, Progress, StatusBadge, type Tone } from "../../components/ui";
import { logWarn } from "../../lib/log";

export const dynamic = "force-dynamic";
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ plan?: string | string[] }> }) {
  const jar = await cookies();
  const claims = await verifyWorkspaceTokenFromCookieValues(jar.get(sessionCookieName("customer"))?.value ?? null, jar.get(getManagerCookieName())?.value ?? null);
  if (!claims) redirect("/login?next=%2Fbilling");
  if (!claims.userId || !hasManagerPermission(claims, "billing.read")) redirect("/dashboard");
  const locale = await getServerLocale(); const t = makeT(locale);
  const params = await searchParams;
  const [sub, tenant, availablePlans, requests, now] = await Promise.all([
    db.query.tenantSubscriptions.findFirst({ where: eq(tenantSubscriptions.tenantId, claims.tenantId) }),
    db.query.tenants.findFirst({ where: eq(tenants.id, claims.tenantId), columns: { lifecycle: true } }),
    db.select({ id: plans.id, name: plans.name, entitlements: plans.entitlements }).from(plans).where(and(eq(plans.isActive, true), eq(plans.isPublic, true))).orderBy(asc(plans.displayOrder), asc(plans.name)),
    claims.role === "owner" ? db.query.subscriptionRequests.findMany({ where: eq(subscriptionRequests.tenantId, claims.tenantId), orderBy: desc(subscriptionRequests.createdAt), limit: 1 }) : Promise.resolve([]),
    databaseNowMs(),
  ]);
  const plan = sub ? await db.query.plans.findFirst({ where: eq(plans.id, sub.planId), columns: { name: true, entitlements: true } }) : null;
  const status = customerSubscriptionState(sub, tenant?.lifecycle, now);
  const statusKey = { active: "v4.onboarding.active", awaiting_activation: "v4.onboarding.pending", expired: "v4.onboarding.expired", suspended: "v4.onboarding.suspended" } as const;
  const tone: Tone = status === "active" ? "ok" : status === "suspended" ? "bad" : "warn";
  let usage: { used: number; limit: number | "unlimited"; remaining: number | "unlimited"; reset: Date } | null = null;
  try {
    if (sub && plan) {
      const quota = effectiveManualEntitlements(plan.entitlements, sub.monthlyQuota).max_prints_per_period;
      // Read the same transactional monthly admission ledger used by quota enforcement,
      // even after expiry. Contract dates never determine this reporting window.
      const row = await db.execute(sql`SELECT coalesce((SELECT used_prints FROM print_monthly_usage WHERE tenant_id=${claims.tenantId} AND period_start=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')),0)::int AS used, (date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC' AS reset`);
      const used = Number(row.rows[0]?.used);
      const reset = new Date(String(row.rows[0]?.reset));
      if (!Number.isSafeInteger(used) || used < 0 || !Number.isFinite(reset.getTime())) throw new Error("Usage unavailable");
      usage = { used, limit: quota, remaining: quota === "unlimited" ? "unlimited" : Math.max(0, quota - used), reset };
    }
  } catch { logWarn("billing.monthly_usage_unavailable", { tenantId: claims.tenantId }); }
  const date = (value: Date | null | undefined) => formatManualCalendarDate(value, locale) ?? t("v4.subscription.notSet");
  const request = requests[0];
  const selectedPlanId = typeof params.plan === "string" ? params.plan : undefined;
  return <>
    <PageHeader title={t("v4.subscription.title")} description={t("v4.subscription.intro")} icon={<CreditCard className="h-4 w-4" />} meta={<StatusBadge tone={tone} label={t(statusKey[status])} />} actions={<Button href="/pricing" variant="secondary">{t("billing.comparePlans")}</Button>} />
    <PageContainer><div className="space-y-5">
      {status !== "active" && <Callout tone={tone} title={t(statusKey[status])}>{t(status === "expired" ? "v4.subscription.expiredBody" : status === "suspended" ? "v4.subscription.suspendedBody" : "v4.subscription.pendingBody")}</Callout>}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]"><div className="space-y-5">
        <Card><CardHeader title={plan?.name ?? t("billing.noPlanSelected")} subtitle={t(status === "active" ? "v4.subscription.currentContract" : "v4.subscription.recordedContract")} icon={<CalendarDays className="h-4 w-4" />} /><dl className="grid gap-5 p-5 sm:grid-cols-2">
          {[[t("v4.subscription.type"), t(sub?.subscriptionType === "free" ? "v4.subscription.free" : sub?.subscriptionType === "paid" ? "v4.subscription.paid" : "v4.subscription.notSet")], [t("v4.onboarding.term"), billingTermLabel(sub?.term, t)], [t("v4.subscription.start"), date(sub?.currentPeriodStart)], [t("v4.subscription.end"), date(sub?.currentPeriodEnd)]].map(([label,value]) => <div key={label}><dt className="text-sm text-ink-3">{label}</dt><dd className="mt-1 font-semibold"><bdi dir="auto">{value}</bdi></dd></div>)}
        </dl><p className="border-t border-edge-subtle p-5 text-sm text-ink-3">{t(sub?.cancelAtPeriodEnd ? "v4.subscription.endsAtTerm" : "v4.subscription.manualRenewal")}</p>
        </Card>
        <Card><CardHeader title={t("v4.subscription.monthlyUsage")} />{usage ? <div className="space-y-4 p-5"><dl className="grid gap-4 sm:grid-cols-3">{[[t("v4.subscription.used"),formatNumber(usage.used,locale)],[t("v4.subscription.allowance"),usage.limit === "unlimited" ? t("billing.unlimited") : formatNumber(usage.limit,locale)],[t("v4.subscription.remaining"),usage.remaining === "unlimited" ? t("billing.unlimited") : formatNumber(usage.remaining,locale)]].map(([label,value]) => <div key={label}><dt className="text-sm text-ink-3">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums"><bdi dir="ltr">{value}</bdi></dd></div>)}</dl>{usage.limit !== "unlimited" && <Progress value={Math.min(100,usage.used / Math.max(1,usage.limit)*100)} tone={usage.remaining === 0 ? "bad" : "brand"} label={t("billing.usageAria", { used: formatNumber(usage.used,locale), limit: formatNumber(usage.limit,locale) })} />}<p className="text-sm text-ink-3">{t("v4.subscription.nextReset", { date: date(usage.reset) })}</p>{status !== "active" && <p className="text-sm text-ink-3">{t("v4.subscription.balanceNotAccess")}</p>}</div> : <p className="p-5 text-sm text-ink-3">{t(sub ? "billing.usageUnavailableBody" : "v4.subscription.noAllowance")}</p>}</Card>
        
      </div><Card><div className="p-5"><BillingActions key={`${selectedPlanId ?? ""}:${request?.id ?? "none"}:${request?.status ?? "none"}`} plans={availablePlans} selectedPlanId={selectedPlanId} currentPlanId={sub?.planId} currentTerm={sub?.term} isOwner={claims.role === "owner"} status={status} initialRequest={request ? { id:request.id,reference:request.id,status:request.status,planId:request.planId,term:request.term,requestedMonthlyQuota:request.requestedMonthlyQuota,approvalModified:request.approvalModified,approvedPlanId:request.approvedPlanId,approvedTerm:request.approvedTerm,approvedMonthlyQuota:request.approvedMonthlyQuota,createdAt:request.createdAt.toISOString(),whatsappUrl:activationWhatsAppUrl(request.id) } : null} /></div></Card></div>
    </div></PageContainer>
  </>;
}
