"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowUpRight, RefreshCw } from "lucide-react";
import { Button, Card, ErrorState, PageHeader, PageSkeleton } from "../../../components/ui";
import { fetchWithTimeout } from "../../../lib/fetch-timeout";
import { useI18n } from "../../../i18n/react";

type Stats = {
  tenants: { total: number; active: number; suspended: number };
  agents: { active: number; online: number; offline: number; unknown: number };
  printers: { active: number; online: number; busy: number; offline: number; error: number; unknown: number };
  queueNow: { queued: number; inFlight: number };
  jobs24h: { total: number; success: number; failed: number; expired: number };
  subscriptions: { attention: number };
  integrations?: { keys: { active: number } };
};

export default function PlatformDashboardPage() {
  const router = useRouter();
  const { locale, formatNumber, t } = useI18n();
  const ar = locale === "ar";
  const [stats, setStats] = useState<Stats | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const response = await fetchWithTimeout("/api/platform/stats", {
          cache: "no-store", signal: controller.signal,
        });
        if (!active) return;
        if (response.status === 401 || response.status === 403) {
          router.replace("/platform/login");
          return;
        }
        if (!response.ok) throw Error("Gateway overview temporarily unavailable");
        const data = await response.json() as Stats;
        if (!active) return;
        setStats(data);
        setUpdatedAt(new Date().toLocaleTimeString(locale === "ar" ? "ar-EG" : "en-US"));
        setError("");
      } catch {
        if (active) setError(ar ? "تعذر تحديث بيانات المنصة. راجع الاتصال وأعد المحاولة." : "Could not refresh platform data. Check the connection and retry.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [refresh, router, ar, locale]);

  // The live queue is independent of jobs created in the past 24 hours.
  const queue = { queued: stats?.queueNow?.queued ?? 0, inFlight: stats?.queueNow?.inFlight ?? 0 };
  const signals = [
    { label: ar ? "فشل أو انتهت صلاحيته خلال 24 ساعة" : "Failed / expired jobs in 24h",
      value: (stats?.jobs24h.failed ?? 0) + (stats?.jobs24h.expired ?? 0), href: "/platform/jobs" },
    { label: ar ? "أيجنت تحتاج متابعة" : "Agents needing attention",
      value: (stats?.agents.offline ?? 0) + (stats?.agents.unknown ?? 0), href: "/platform/fleet" },
    { label: ar ? "اشتراكات تحتاج متابعة" : "Billing issues",
      value: stats?.subscriptions.attention ?? 0, href: "/platform/subscriptions" },
  ];
  const links = [
    { label: ar ? "مساحات العمل" : "Workspaces", href: "/platform/tenants" },
    { label: ar ? "الطابعات والأيجنت" : "Printer & Agent control", href: "/platform/fleet" },
    { label: ar ? "مفاتيح API" : "API keys", href: "/platform/integrations" },
    { label: ar ? "سجل العمليات" : "Audit log", href: "/platform/audit" },
  ];
  const tiles = [
    { label: ar ? "مساحات العمل النشطة" : "Active workspaces",
      value: stats?.tenants.active ?? 0, sub: `/ ${formatNumber(stats?.tenants.total ?? 0)}`, href: "/platform/tenants" },
    { label: ar ? "الأيجنت المتصلة" : "Online Agents",
      value: stats?.agents.online ?? 0, sub: `/ ${formatNumber(stats?.agents.active ?? 0)}`, href: "/platform/fleet" },
    { label: ar ? "الطابعات الجاهزة" : "Available printers",
      value: (stats?.printers.online ?? 0) + (stats?.printers.busy ?? 0),
      sub: `/ ${formatNumber(stats?.printers.active ?? 0)}`, href: "/platform/fleet" },
    { label: ar ? "مهام في الانتظار الآن" : "Jobs waiting now",
      value: queue.queued, sub: `${formatNumber(queue.inFlight)} ${ar ? "قيد التنفيذ" : "in progress"}`, href: "/platform/jobs" },
    { label: ar ? "مهام تمت خلال 24 ساعة" : "Jobs printed in 24h",
      value: stats?.jobs24h.success ?? 0, sub: `/ ${formatNumber(stats?.jobs24h.total ?? 0)}`, href: "/platform/jobs" },
    { label: ar ? "مفاتيح API مصرح لها" : "Authorized API keys",
      value: stats?.integrations?.keys.active ?? 0, sub: ar ? "مفاتيح فعالة" : "active credentials", href: "/platform/integrations" },
  ];

  return <div className="space-y-6 pb-10">
    <PageHeader variant="inline" title={t("platform.dashboard.title")}
      description={ar ? "حالة الجيتواي الآن، والمشاكل اللي محتاجة تدخّل، وروابط التحكم الأساسية." : "Operational status, issues requiring attention, and essential controls."}
      actions={<Button variant="secondary" size="sm" loading={loading} disabled={loading} icon={loading ? undefined : <RefreshCw className="h-4 w-4" />} onClick={() => setRefresh(n => n + 1)}>{ar ? "تحديث" : "Refresh"}</Button>}
    />
    {error && <ErrorState title={ar ? "تعذر جلب البيانات" : "Overview unavailable"} message={error} retry={() => setRefresh(n => n + 1)} />}
    {!stats ? (!error && <PageSkeleton />) : <>
      <div className="flex items-center justify-between gap-3 text-xs text-ink-3">
        <span>{ar ? "آخر قراءة" : "Last refreshed"}: {updatedAt || "—"}</span>
        {loading && <span role="status">{ar ? "جارٍ التحديث" : "Refreshing"}</span>}
      </div>
      <section aria-label={ar ? "المؤشرات الأساسية" : "Essential metrics"} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map(item => <Link key={item.href + item.label} href={item.href}
          className="group rounded-xl border border-edge bg-surface px-5 py-5 transition-colors hover:border-brand/40 focus-visible:outline-2 focus-visible:outline-brand">
          <div className="flex justify-between gap-3 text-sm font-medium text-ink-3">
            <span>{item.label}</span><ArrowUpRight className="h-4 w-4 shrink-0 text-ink-4" aria-hidden />
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <strong className="text-3xl font-semibold tabular-nums tracking-tight text-ink">{formatNumber(item.value)}</strong>
            <span className="text-xs text-ink-3">{item.sub}</span>
          </div>
        </Link>)}
      </section>
      <Card className="p-5">
        <h2 className="text-base font-semibold text-ink">{ar ? "يحتاج متابعة" : "Needs attention"}</h2>
        <div className="mt-4 divide-y divide-edge-subtle">
          {signals.map(signal => <Link href={signal.href} key={signal.href}
            className="flex min-h-14 items-center justify-between gap-3 py-3 hover:text-brand focus-visible:outline-2 focus-visible:outline-brand">
            <span className="flex items-center gap-2 text-sm text-ink-2">
              {signal.value > 0 && <AlertCircle className="h-4 w-4 shrink-0 text-warn" aria-hidden />}{signal.label}
            </span>
            <span className={`text-sm font-semibold tabular-nums ${signal.value > 0 ? "text-warn" : "text-ink-3"}`}>{formatNumber(signal.value)}</span>
          </Link>)}
        </div>
      </Card>
      <section aria-label={ar ? "الإدارة" : "Management"} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {links.map(link => <Link key={link.href} href={link.href}
          className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-edge bg-surface px-4 py-3 text-sm font-medium text-ink-2 transition-colors hover:border-brand/40 hover:text-brand focus-visible:outline-2 focus-visible:outline-brand">
          {link.label}<ArrowUpRight className="h-4 w-4 shrink-0 text-ink-4" aria-hidden />
        </Link>)}
      </section>
    </>}
  </div>;
}
