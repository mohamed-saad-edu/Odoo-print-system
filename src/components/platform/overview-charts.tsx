"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useId } from "react";
import { useI18n } from "../../i18n/react";

export type OverviewHourlyPoint = {
  bucket: string;
  total: number;
  success: number;
  failed: number;
  queued: number;
  inFlight: number;
  expired: number;
};

type Fleet = {
  agents: { active: number; healthy: number };
  printers: { active: number; healthy: number };
};

type Subscriptions = {
  total: number;
  active: number;
  trialing: number;
  attention: number;
  paused: number;
  cancelled: number;
};

function rate(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function linePath(values: number[], width: number, height: number, top: number, bottom: number, max: number) {
  const plotHeight = height - top - bottom;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  return values
    .map((value, index) => {
      const x = index * step;
      const y = top + plotHeight - (value / max) * plotHeight;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function areaPath(values: number[], width: number, height: number, top: number, bottom: number, max: number) {
  if (!values.length) return "";
  const plotHeight = height - top - bottom;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, index) => {
    const x = index * step;
    const y = top + plotHeight - (value / max) * plotHeight;
    return [x, y] as const;
  });
  return `M 0 ${height - bottom} L ${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ")} L ${width} ${height - bottom} Z`;
}

export function PrintThroughputChart({
  data,
}: {
  data: OverviewHourlyPoint[];
}) {
  const { t, formatNumber, formatTime } = useI18n();
  const gradientId = useId().replace(/:/g, "");
  const width = 760;
  const height = 282;
  const top = 22;
  const bottom = 34;
  const totals = data.map((point) => point.total);
  const success = data.map((point) => point.success);
  const failed = data.map((point) => point.failed);
  const max = Math.max(1, ...totals);
  const total = totals.reduce((n, value) => n + value, 0);
  const ok = success.reduce((n, value) => n + value, 0);
  const fail = failed.reduce((n, value) => n + value, 0);

  const labels = data.map((point) => formatTime(point.bucket));
  const captionMiddleIndex = Math.round((labels.length - 1) / 8) * 4;

  return (
    <div className="mt-5">
      <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl border border-edge bg-surface-2/80 p-3 sm:gap-5 sm:p-4" role="group" aria-label={t("platform.chart.throughputAria")}>
        {[{ value:total, label:t("platform.chart.allPrintJobs"), accent:"text-brand" }, { value:ok, label:t("platform.chart.successful"), accent:"text-ok" }, { value:fail, label:t("platform.chart.failed"), accent:"text-bad" }].map(item => <div key={item.label} className="min-w-0"><div className={`truncate text-xl font-bold tabular-nums tracking-tight sm:text-2xl ${item.accent}`}>{formatNumber(item.value)}</div><div className="mt-1 truncate text-xs text-ink-3">{item.label}</div></div>)}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-3">
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-brand-solid" />{t("platform.chart.allPrintJobs")}</span>
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-ok-solid" />{t("platform.chart.successful")}</span>
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-bad-solid" />{t("platform.chart.failed")}</span>
      </div>
      <div className="yw-throughput-plot mt-3 overflow-hidden rounded-xl border border-edge bg-surface-2 px-3 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="block h-auto w-full"
          role="img"
          aria-label={t("platform.chart.throughputAria")}
        >
          <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#38BDF8" stopOpacity="0.25"/><stop offset="88%" stopColor="#38BDF8" stopOpacity="0.015"/></linearGradient></defs>
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const y = top + (height - top - bottom) * (1 - fraction);
            return (
              <line
                key={fraction}
                x1="0"
                x2={width}
                y1={y}
                y2={y}
                className="stroke-edge"
                strokeDasharray={fraction === 0 ? undefined : "4 8"}
                strokeOpacity={fraction === 0 ? 0.8 : 0.55}
                strokeWidth="1"
              />
            );
          })}
          <path d={areaPath(totals, width, height, top, bottom, max)} fill={`url(#${gradientId})`} />
          <path d={linePath(totals, width, height, top, bottom, max)} className="fill-none stroke-brand-solid" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.5" vectorEffect="non-scaling-stroke" />
          <path d={linePath(success, width, height, top, bottom, max)} className="fill-none stroke-ok-solid" strokeLinecap="round" strokeWidth="2.75" vectorEffect="non-scaling-stroke" />
          <path d={linePath(failed, width, height, top, bottom, max)} className="fill-none stroke-bad-solid" strokeLinecap="round" strokeDasharray="5 4" strokeWidth="2.25" vectorEffect="non-scaling-stroke" />
          {data.map((point, index) => {
            const x = data.length > 1 ? (index / (data.length - 1)) * width : width / 2;
            const y = top + (height - top - bottom) * (1 - point.total / max);
            return (
              <circle key={point.bucket} cx={x} cy={y} r="3.8" className="fill-brand-solid stroke-surface-2" strokeWidth="2.4">
                <title>{t("platform.chart.pointTitle", { time: labels[index] ?? "", count: formatNumber(point.total) })}</title>
              </circle>
            );
          })}
        </svg>
        {/* HTML labels retain the shared text size when the plot scales down. */}
        <div className="yw-throughput-axis mt-2 tabular-nums text-ink-3" dir="ltr">
          {labels.map((label, index) => {
            if (index % 4 !== 0 && index !== labels.length - 1) return null;
            const first = index === 0;
            const last = index === labels.length - 1;
            const centered = labels.length === 1;
            const left = centered ? 50 : (index / (labels.length - 1)) * 100;
            const anchor = centered || (!first && !last) ? "-translate-x-1/2" : last ? "-translate-x-full" : "";
            const validMiddle = index === captionMiddleIndex
              && index * 3 >= labels.length - 1 && index * 3 <= (labels.length - 1) * 2;
            const caption = first || last ? "edge" : validMiddle ? "middle" : "hidden";
            const alignment = centered || (!first && !last) ? "text-center" : last ? "text-end" : "text-start";
            return (
              <span
                key={`${label}-${index}`}
                style={{ left: `${left}%` }}
                data-axis-caption={caption}
                className={`yw-throughput-tick ${anchor} ${alignment}`}
              >
                {label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AvailabilityRing({
  label,
  healthy,
  total,
  tone,
}: {
  label: string;
  healthy: number;
  total: number;
  tone: "brand" | "ok";
}) {
  const { t, formatNumber } = useI18n();
  const percentage = rate(healthy, total);
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-4 rounded-xl border border-edge bg-surface-2/60 p-4">
      <div className="relative h-[112px] w-[112px] shrink-0 rounded-full bg-surface-2 p-2 shadow-[inset_0_0_0_1px_var(--edge)]">
        <svg viewBox="0 0 96 96" className="h-full w-full -rotate-90 drop-shadow-sm" aria-hidden>
          <circle cx="48" cy="48" r={radius} fill="none" className="stroke-surface-3" strokeWidth="9" />
          <circle
            cx="48"
            cy="48"
            r={radius}
            fill="none"
            className={tone === "brand" ? "stroke-brand-solid" : "stroke-ok-solid"}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-xl font-bold tabular-nums text-ink">
          {percentage}%
        </div>
      </div>
      <div className="min-w-0 flex-1 basis-32 [overflow-wrap:anywhere]">
        <div className="text-sm font-semibold text-ink">{label}</div>
        <div className="mt-1 text-xs text-ink-3">
          {total > 0
            ? t("platform.fleet.healthyOfActive", { healthy: formatNumber(healthy), total: formatNumber(total) })
            : t("platform.fleet.noneActive")}
        </div>
        <div
          className={`mt-2 inline-flex items-center gap-1.5 text-xs font-[550] ${
            total === 0 ? "text-ink-4" : percentage >= 95 ? "text-ok" : percentage >= 80 ? "text-warn" : "text-bad"
          }`}
        >
          {total === 0 || percentage >= 95 ? (
            <CheckCircle2 className="h-3 w-3" aria-hidden />
          ) : (
            <AlertTriangle className="h-3 w-3" aria-hidden />
          )}
          {total === 0
            ? t("platform.fleet.noneActive")
            : percentage >= 95
              ? t("platform.fleet.healthy")
              : percentage >= 80
                ? t("platform.fleet.attention")
                : t("platform.fleet.risk")}
        </div>
      </div>
    </div>
  );
}

export function FleetHealthChart({ fleet }: { fleet: Fleet }) {
  const { t } = useI18n();
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      <AvailabilityRing label={t("platform.fleet.agents")} healthy={fleet.agents.healthy} total={fleet.agents.active} tone="brand" />
      <AvailabilityRing label={t("platform.fleet.printers")} healthy={fleet.printers.healthy} total={fleet.printers.active} tone="ok" />
    </div>
  );
}

export function SubscriptionMixChart({ subscriptions }: { subscriptions: Subscriptions }) {
  const { t, formatNumber } = useI18n();
  const segments = [
    { id: "active", label: t("platform.subs.active"), value: subscriptions.active, bg: "bg-ok-solid", bar: "#19C3A4" },
    { id: "trialing", label: t("platform.subs.trialing"), value: subscriptions.trialing, bg: "bg-info-solid", bar: "#38BDF8" },
    { id: "attention", label: t("platform.subs.attention"), value: subscriptions.attention, bg: "bg-warn-solid", bar: "#F7B955" },
    { id: "paused", label: t("platform.subs.paused"), value: subscriptions.paused, bg: "bg-ink-4", bar: "#94A3B8" },
    { id: "cancelled", label: t("platform.subs.cancelled"), value: subscriptions.cancelled, bg: "bg-bad-solid", bar: "#F26670" },
  ];
  const total = Math.max(1, subscriptions.total);
  const accounted = segments.reduce((sum, item) => sum + item.value, 0);
  const other = Math.max(0, subscriptions.total - accounted);
  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-xl border border-edge bg-surface-2/70 px-4 py-4">
        <div className="mb-3 flex items-baseline justify-between gap-3"><span className="text-xs font-semibold uppercase tracking-wider text-ink-3">{t("platform.dashboard.subscriptionsLabel")}</span><span className="text-2xl font-bold tabular-nums text-ink">{formatNumber(subscriptions.total)}</span></div>
        <div className="flex h-4 overflow-hidden rounded-full bg-surface-3 shadow-inner" role="img" aria-label={segments.map(segment => `${segment.label}: ${formatNumber(segment.value)}`).join(", ")}>
          {segments.map((segment) => segment.value > 0 ? <div key={segment.id} style={{width:`${100 * segment.value / total}%`, backgroundColor:segment.bar}} title={t("platform.subs.segmentTitle",{label:segment.label,value:formatNumber(segment.value)})} /> : null)}
          {other > 0 && <div style={{width:`${100*other/total}%`}} className="bg-surface-3" title={`${formatNumber(other)} other`} />}
        </div>
      </div>
      <div className="space-y-3" role="list">
        {segments.map((segment) => <div key={segment.id} role="listitem" className="grid grid-cols-[minmax(0,1fr)_minmax(90px,2fr)_auto] items-center gap-3 text-sm">
          <span className="inline-flex min-w-0 items-center gap-2 truncate text-ink-2"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${segment.bg}`} aria-hidden />{segment.label}</span>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full" style={{backgroundColor:segment.bar,width:`${100*segment.value/total}%`}} /></div>
          <span className="min-w-[32px] text-end font-semibold tabular-nums text-ink">{formatNumber(segment.value)}</span>
        </div>)}
      </div>
    </div>
  );
}

export function OperationalSignals({
  jobs,
  agents,
  printers,
  pastDue,
}: {
  jobs: { failed: number; expired: number; queued: number; inFlight: number };
  agents: { attention: number };
  printers: { attention: number };
  pastDue: number;
}) {
  const { t, formatNumber } = useI18n();
  const signals = [
    {
      id: "reliability",
      label: t("platform.signal.reliability"),
      value: jobs.failed + jobs.expired,
      detail: t("platform.signal.reliability.detail"),
      tone: jobs.failed + jobs.expired === 0 ? "ok" : "bad",
    },
    {
      id: "queue",
      label: t("platform.signal.queuePressure"),
      value: jobs.queued + jobs.inFlight,
      detail: t("platform.signal.queuePressure.detail"),
      tone: jobs.queued + jobs.inFlight === 0 ? "ok" : "warn",
    },
    {
      id: "agents",
      label: t("platform.signal.agentAttention"),
      value: agents.attention,
      detail: t("platform.signal.agentAttention.detail"),
      tone: agents.attention === 0 ? "ok" : "warn",
    },
    {
      id: "printers",
      label: t("platform.signal.printerAttention"),
      value: printers.attention,
      detail: t("platform.signal.printerAttention.detail"),
      tone: printers.attention === 0 ? "ok" : "warn",
    },
    {
      id: "billing",
      label: t("platform.signal.billing"),
      value: pastDue,
      detail: t("platform.signal.billing.detail"),
      tone: pastDue === 0 ? "ok" : "warn",
    },
  ] as const;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {signals.map((signal) => (
        <div key={signal.id} className="inset-panel min-w-0 p-4 [overflow-wrap:anywhere]">
          <div className="text-sm font-[600] text-ink-2">{signal.label}</div>
          <div className="mt-2.5 flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-[660] tabular-nums tracking-[-0.02em] text-ink">
              {formatNumber(signal.value)}
            </span>
            <span
              className={`inline-flex items-center gap-1 text-xs font-[550] ${
                signal.tone === "ok" ? "text-ok" : signal.tone === "warn" ? "text-warn" : "text-bad"
              }`}
            >
              {signal.tone === "ok" ? (
                <CheckCircle2 className="h-3 w-3" aria-hidden />
              ) : (
                <AlertTriangle className="h-3 w-3" aria-hidden />
              )}
              {signal.tone === "ok" ? t("platform.signal.clear") : signal.tone === "warn" ? t("platform.signal.watch") : t("platform.signal.action")}
            </span>
          </div>
          <div className="mt-1 text-xs text-ink-4">{signal.detail}</div>
        </div>
      ))}
    </div>
  );
}
