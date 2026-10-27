"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, PageHeader } from "../../../components/ui";
import { AdminStatus, adminJson, controlClass, useAdminText } from "../../../components/platform/ManualAdmin";

type Subscription = {
  tenantId: string;
  tenantName: string;
  planName: string;
  status: string;
  subscriptionType: string;
  monthlyQuota: number | null;
  used: number;
  currentPeriodEnd: string | null;
  term: string;
};

export default function Subscriptions() {
  const { a, formatDate, formatNumber } = useAdminText();
  const [items, setItems] = useState<Subscription[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    adminJson("/api/platform/subscriptions?search=" + encodeURIComponent(search))
      .then((data: { subscriptions: Subscription[] }) => {
        if (live) { setItems(data.subscriptions); setError(false); }
      })
      .catch(() => { if (live) { setItems([]); setError(true); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [search, tick]);

  const visible = items.filter(item => status === "all" || item.status === status);
  return <div className="space-y-5">
    <PageHeader variant="inline" title={a("subscriptions")} actions={
      <div className="flex flex-wrap gap-2">
        <Link className="rounded-lg border border-edge px-4 py-2 text-sm" href="/platform/plans">{a("editPlan")}</Link>
        <Button onClick={() => { setLoading(true); setError(false); setTick(n => n + 1); }}>{a("refresh")}</Button>
      </div>} />
    <div className="grid gap-3 sm:grid-cols-2">
      <input className={controlClass} aria-label={a("search")} placeholder={a("search")} value={search}
        onChange={event => { setLoading(true); setError(false); setSearch(event.target.value); }} />
      <select className={controlClass} aria-label={a("status")} value={status}
        onChange={event => setStatus(event.target.value)}>
        {["all", "active", "awaiting_activation", "expired", "suspended"].map(value =>
          <option key={value} value={value}>{a(value)}</option>)}
      </select>
    </div>
    {error && <p role="alert" className="text-bad">{a("loadError")}</p>}
    {loading ? <p role="status">{a("loading")}</p> : !error && visible.length === 0
      ? <p className="rounded-xl border border-edge p-5 text-sm text-ink-3">{a("empty")}</p>
      : <div className="grid gap-4 lg:grid-cols-2">
        {visible.map(item => <Card key={item.tenantId} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="break-words text-lg font-semibold">{item.tenantName}</h2>
              <p className="mt-1 text-sm text-ink-3">
                <bdi dir="auto">{item.planName}</bdi> · {a(item.term)} · {a(item.subscriptionType)}
              </p>
            </div>
            <AdminStatus status={item.status} />
          </div>
          <dl className="my-5 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-ink-3">{a("usedOfQuota")}</dt>
              <dd className="mt-1 font-semibold tabular-nums">
                <bdi dir="ltr">{formatNumber(item.used)} / {item.monthlyQuota === null ? a("unlimited") : formatNumber(item.monthlyQuota)}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">{a("end")}</dt>
              <dd className="mt-1 font-semibold tabular-nums">
                {item.currentPeriodEnd ? <bdi dir="ltr">{formatDate(item.currentPeriodEnd)}</bdi> : a("notRecorded")}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-4 border-t border-edge-subtle pt-4">
            <Link className="text-sm font-semibold text-brand underline-offset-4 hover:underline"
              href={"/platform/tenants/" + encodeURIComponent(item.tenantId) + "?tab=subscriptions"}>
              {a("manage")}
            </Link>
            {item.status === "active" && <Link
              className="text-sm font-medium text-bad underline-offset-4 hover:underline"
              href={"/platform/tenants/" + encodeURIComponent(item.tenantId) + "?subscriptionAction=revoke"}>
              {a("endSubscriptionNow")}
            </Link>}
          </div>
        </Card>)}
      </div>}
  </div>;
}
