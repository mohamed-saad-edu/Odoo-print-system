"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, ClipboardList } from "lucide-react";
import { Button, Card, PageHeader } from "../../../components/ui";
import { AdminStatus, adminJson, controlClass, useAdminText } from "../../../components/platform/ManualAdmin";

type RequestRow = {
  id: string;
  tenant_id: string;
  tenantName: string;
  plan_id: string;
  planName: string;
  planMonthlyQuota: number | null;
  currentPlanName: string | null;
  currentSubscriptionStatus: string | null;
  requester_name: string;
  requester_email: string;
  requested_monthly_quota: number | null;
  term: string;
  status: string;
  created_at: string;
  last_action_reason: string | null;
};
type RequestResponse = { requests: RequestRow[]; hasMore: boolean; pendingCount: number };

export default function Requests() {
  const { a, t, formatDateTime, formatNumber } = useAdminText();
  const [items, setItems] = useState<RequestRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    adminJson(`/api/platform/subscription-requests?status=${encodeURIComponent(status)}&offset=${offset}`)
      .then((result: RequestResponse) => {
        if (!live) return;
        setItems(result.requests);
        setHasMore(result.hasMore === true);
        setPendingCount(result.pendingCount);
        setError(false);
      })
      .catch(() => {
        if (live) { setError(true); setItems([]); setHasMore(false); setPendingCount(0); }
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [status, tick, offset]);

  return <div className="space-y-5">
    <PageHeader variant="inline" title={a("requests")} actions={<Button onClick={() => { setLoading(true); setTick(x => x + 1); }}>{a("refresh")}</Button>} />
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-center gap-3">
        <span className="rounded-lg bg-brand/10 p-2.5 text-brand"><ClipboardList className="h-5 w-5" aria-hidden /></span>
        <div>
          <p className="text-sm text-ink-3">{a("pendingRequests")}</p>
          <p className="text-2xl font-semibold tabular-nums" aria-live="polite">{formatNumber(pendingCount)}</p>
        </div>
      </div>
      <label className="w-full text-sm sm:w-52">
        <span className="sr-only">{a("status")}</span>
        <select className={controlClass} aria-label={a("status")} value={status}
          onChange={e => { setLoading(true); setStatus(e.target.value); setOffset(0); }}>
          {["pending", "approved", "rejected", "all"].map(item => <option key={item} value={item}>{a(item)}</option>)}
        </select>
      </label>
    </div>
    {error && <p role="alert" className="text-bad">{a("loadError")}</p>}
    {loading ? <p role="status">{a("loading")}</p> : !error && !items.length
      ? <p className="rounded-xl border border-edge bg-surface p-6 text-sm text-ink-3">{a("empty")}</p>
      : <div className="grid gap-4">
          {items.map(request => {
            const quota = request.requested_monthly_quota ?? request.planMonthlyQuota;
            return <Card key={request.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">{request.tenantName}</h2>
                  <p className="mt-1 break-all font-mono text-xs text-ink-3" dir="ltr">{request.id}</p>
                </div>
                <AdminStatus status={request.status} />
              </div>
              <dl className="mt-5 grid gap-4 rounded-lg bg-surface-2 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-ink-3">{a("requestedPlan")}</dt><dd className="mt-1 font-semibold">{request.planName}</dd></div>
                <div><dt className="text-ink-3">{a("term")}</dt><dd className="mt-1 font-semibold">{a(request.term)}</dd></div>
                <div><dt className="text-ink-3">{a("quota")}</dt><dd className="mt-1 font-semibold">{quota === null ? a("notRecorded") : formatNumber(quota)}</dd></div>
                <div><dt className="text-ink-3">{a("created")}</dt><dd className="mt-1 font-semibold">{formatDateTime(request.created_at)}</dd></div>
              </dl>
              <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0 text-sm">
                  <p className="text-ink-3">{a("requester")}</p>
                  <p className="font-medium">{request.requester_name || a("notRecorded")}</p>
                  <p className="break-all text-ink-2" dir="ltr">{request.requester_email}</p>
                  {request.currentPlanName && <p className="mt-2 text-ink-3">{a("currentSubscription")}: {request.currentPlanName}</p>}
                  {request.last_action_reason && <p className="mt-2 text-ink-3">{request.last_action_reason}</p>}
                </div>
                <Link className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  href={`/platform/tenants/${encodeURIComponent(request.tenant_id)}?request=${encodeURIComponent(request.id)}`}>
                  {request.status === "pending" ? a("review") : a("open")} <ArrowUpRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
            </Card>;
          })}
        </div>}
    {!error && !loading && (offset > 0 || hasMore) && <nav className="flex justify-end gap-3" aria-label={a("requests")}>
      <Button disabled={offset === 0} onClick={() => { setLoading(true); setOffset(x => Math.max(0, x - 100)); }}>{t("common.previousPage")}</Button>
      <Button disabled={!hasMore} onClick={() => { setLoading(true); setOffset(x => x + 100); }}>{t("common.nextPage")}</Button>
    </nav>}
  </div>;
}
