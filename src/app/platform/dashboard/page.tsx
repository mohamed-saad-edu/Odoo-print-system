"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, BadgeCheck, Building2, CalendarClock, ClipboardList, Printer, Server, TriangleAlert } from "lucide-react";
import { Button, Card, PageHeader } from "../../../components/ui";
import { AdminMetric, adminJson, useAdminText } from "../../../components/platform/ManualAdmin";

type Stats = {
  tenants: { total: number; suspended: number };
  business: { active: number; pendingRequests: number; free: number; paid: number; expiringSoon: number; suspended: number };
  logicalUsage: { today: number; month: number; year: number };
  agents: { online: number; total: number; unknown: number; offline: number };
  printers: { offline: number; unknown: number; error: number };
  verifiedPrinters: number;
  jobs24h: { failed: number; expired: number };
  queueNow: { inFlight: number; queued: number };
};

export default function PlatformDashboard() {
  const { a, formatNumber } = useAdminText();
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    adminJson("/api/platform/stats").then((result: Stats) => {
      if (live) { setData(result); setError(false); }
    }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [tick]);

  return <div className="space-y-5">
    <PageHeader variant="inline" title={a("overview")} actions={<Button onClick={() => setTick(x => x + 1)}>{a("refresh")}</Button>} />
    {error && <p role="alert" className="text-bad">{a("loadError")}</p>}
    {!data
      ? <p role="status">{a("loading")}</p>
      : <>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <AdminMetric label={a("totalWorkspaces")} value={formatNumber(data.tenants.total)} icon={<Building2 className="h-5 w-5" />}
            detail={<Link className="font-medium text-brand hover:underline" href="/platform/tenants">{a("workspaces")}</Link>} />
          <AdminMetric label={a("activeWorkspaces")} value={formatNumber(data.business.active)} icon={<BadgeCheck className="h-5 w-5" />}
            detail={`${a("freePaid")}: ${formatNumber(data.business.free)} / ${formatNumber(data.business.paid)}`} />
          <AdminMetric label={a("pendingRequests")} value={formatNumber(data.business.pendingRequests)} icon={<ClipboardList className="h-5 w-5" />}
            detail={<Link className="font-semibold text-brand hover:underline" href="/platform/subscription-requests">{a("review")}</Link>} />
          <AdminMetric label={a("expiring")} value={formatNumber(data.business.expiringSoon)} icon={<CalendarClock className="h-5 w-5" />}
            detail={<Link className="font-medium text-brand hover:underline" href="/platform/subscriptions">{a("manage")}</Link>} />
        </div>
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Activity className="h-5 w-5 text-brand" aria-hidden />{a("activity")}
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {(["today", "month", "year"] as const).map(key => <div key={key} className="rounded-lg bg-surface-2 p-4">
              <p className="text-sm text-ink-3">{a(key)}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{formatNumber(data.logicalUsage[key])}</p>
            </div>)}
          </div>
          <p className="mt-3 text-xs text-ink-3">{a("semantics")}</p>
        </Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <AdminMetric label={a("connected")} value={`${formatNumber(data.agents.online)} / ${formatNumber(data.agents.total)}`}
            icon={<Server className="h-5 w-5" />} detail={<Link href="/platform/fleet" className="font-medium text-brand hover:underline">{a("devices")}</Link>} />
          <AdminMetric label={a("verifiedPrinters")} value={formatNumber(data.verifiedPrinters)}
            icon={<Printer className="h-5 w-5" />} detail={<Link href="/platform/fleet" className="font-medium text-brand hover:underline">{a("operations")}</Link>} />
          <AdminMetric label={a("needsReview")} value={formatNumber(data.jobs24h.failed + data.jobs24h.expired)}
            icon={<TriangleAlert className="h-5 w-5" />} detail={<Link href="/platform/jobs" className="font-medium text-brand hover:underline">{a("jobs")}</Link>} />
        </div>
        <Card className="grid gap-3 p-4 text-sm sm:grid-cols-2">
          <Link href="/platform/jobs" className="rounded-lg p-2 hover:bg-surface-2 hover:text-brand">
            {a("waitingJobs")}: <b className="tabular-nums">{formatNumber(data.queueNow.queued)}</b>
            <span className="mx-2 text-ink-3">·</span>{a("processingJobs")}: <b className="tabular-nums">{formatNumber(data.queueNow.inFlight)}</b>
          </Link>
          <Link href="/platform/fleet" className="rounded-lg p-2 hover:bg-surface-2 hover:text-brand">
            {a("agentsAttention")}: <b className="tabular-nums">{formatNumber(data.agents.offline + data.agents.unknown)}</b>
            <span className="mx-2 text-ink-3">·</span>{a("printersAttention")}: <b className="tabular-nums">{formatNumber(data.printers.offline + data.printers.error + data.printers.unknown)}</b>
          </Link>
        </Card>
      </>}
  </div>;
}
