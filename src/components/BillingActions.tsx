"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Callout, Field, Select } from "./ui";
import { useI18n } from "../i18n/react";
import { fetchWithTimeout } from "../lib/fetch-timeout";
import { codeMessageKey } from "../lib/api-error-keys";

export type SubscriptionPlanOption = { id: string; name: string; entitlements: Record<string, unknown> };
export type CustomerSubscriptionRequest = {
  id: string; reference: string; status: string; planId: string; term: string; createdAt: string;
  requestedMonthlyQuota?: number | null; whatsappUrl?: string | null;
  approvalModified?: boolean; approvedPlanId?: string | null; approvedTerm?: string | null; approvedMonthlyQuota?: number | null;
};

/** A request records customer intent; only the Platform Owner changes entitlements. */
export function BillingActions({ plans, selectedPlanId, currentPlanId, isOwner, status, initialRequest, currentTerm }: {
  plans: SubscriptionPlanOption[];
  selectedPlanId?: string;
  currentPlanId?: string | null;
  isOwner: boolean;
  status: "awaiting_activation" | "active" | "expired" | "suspended";
  initialRequest?: CustomerSubscriptionRequest | null;
  currentTerm?: string | null;
}) {
  const { t, formatNumber, formatDateTime } = useI18n();
  const router = useRouter();
  const [planId, setPlanId] = useState(() => plans.some(plan => plan.id === selectedPlanId) ? selectedPlanId! : plans.some(plan => plan.id === currentPlanId) ? currentPlanId! : plans[0]?.id ?? "");
  const [term, setTerm] = useState(currentTerm === "yearly" ? "yearly" : "monthly");
  const [request, setRequest] = useState(initialRequest ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const flight = useRef(false);
  const idempotency = useRef<{ fingerprint: string; key: string } | null>(null);
  const selectedPlan = plans.find(plan => plan.id === planId);
  const pending = request?.status === "pending";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!isOwner || flight.current || pending || !selectedPlan) return;
    flight.current = true; setBusy(true); setError("");
    try {
      const fingerprint = `${planId}:${term}`;
      if (idempotency.current?.fingerprint !== fingerprint) idempotency.current = { fingerprint, key: crypto.randomUUID() };
      const response = await fetchWithTimeout("/api/subscription-requests", { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotency.current.key }, body: JSON.stringify({ planId, term }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (body.code === "SUBSCRIPTION_REQUEST_ALREADY_PENDING") {
          setError(t("v4.subscription.pendingAlready"));
          router.refresh();
        } else {
          setError(t(codeMessageKey(body.code) ?? "v4.onboarding.failed"));
        }
        return;
      }
      if (!body.request?.reference) { setError(t("v4.onboarding.failed")); return; }
      setRequest(body.request);
      router.refresh();
    } catch { setError(t("v4.onboarding.failed")); }
    finally { flight.current = false; setBusy(false); }
  }

  return <div className="space-y-4" id="billing-actions">
    {!isOwner ? <Callout tone="info" title={t("v4.subscription.ownerTitle")}>{t("v4.subscription.ownerBody")}</Callout> : pending ? <Callout tone="info" title={t("v4.onboarding.requestReceived")}>
      <p>{t("v4.subscription.requestPending")}</p>
      <dl className="mt-3 space-y-2 text-sm"><div><dt>{t("v4.onboarding.reference")}</dt><dd dir="ltr" className="break-all font-mono">{request.reference}</dd></div><div><dt>{t("v4.onboarding.requestedAt")}</dt><dd>{formatDateTime(request.createdAt)}</dd></div><div><dt>{t("v4.subscription.requestedPlan")}</dt><dd>{plans.find(plan => plan.id === request.planId)?.name ?? request.planId}</dd></div><div><dt>{t("v4.onboarding.term")}</dt><dd>{t(request.term === "yearly" ? "v4.onboarding.yearly" : request.term === "custom" ? "v4.subscription.custom" : "v4.onboarding.monthly")}</dd></div>{typeof request.requestedMonthlyQuota === "number" && <div><dt>{t("v4.subscription.allowance")}</dt><dd>{formatNumber(request.requestedMonthlyQuota)}</dd></div>}</dl>
      <div className="mt-4 flex flex-wrap gap-3">{request.whatsappUrl && <Button href={request.whatsappUrl} target="_blank" rel="noopener noreferrer" variant="primary">{t("v4.onboarding.whatsapp")}</Button>}<Button variant="secondary" onClick={() => router.refresh()}>{t("v4.onboarding.refresh")}</Button></div>
    </Callout> : <>
      {request && <Callout tone={request.status === "approved" ? "ok" : "warn"}
        title={t(request.status === "approved" ? request.approvalModified
          ? "v4.subscription.approvedWithChanges" : "v4.subscription.requestApproved" : "v4.subscription.requestRejected")}>
        <p className="text-sm" dir="ltr">{request.reference}</p>
        {request.status === "approved" && request.approvalModified && <p className="mt-2 text-sm">
          {t("v4.subscription.approvedTerms")}: {plans.find(plan => plan.id === request.approvedPlanId)?.name ?? request.approvedPlanId}
          {" · "}{t(request.approvedTerm === "yearly" ? "v4.onboarding.yearly" : "v4.onboarding.monthly")}
          {typeof request.approvedMonthlyQuota === "number" ? " · " + formatNumber(request.approvedMonthlyQuota) : ""}
        </p>}
      </Callout>
      <form onSubmit={submit} className="space-y-4">
      <h2 className="text-lg font-semibold">{t(status === "active" ? "v4.subscription.changeRenew" : status === "suspended" ? "v4.subscription.reviewAccess" : "v4.onboarding.request")}</h2>
      <p className="text-sm leading-relaxed text-ink-3">{t("v4.subscription.requestBody")}</p>
      <Field label={t("onboarding.choosePlanLegend")} htmlFor="request-plan"><Select id="request-plan" value={planId} onChange={event => setPlanId(event.target.value)} disabled={busy || plans.length === 0} required>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</Select></Field>
      {selectedPlan && <p className="text-sm text-ink-3">{t("v4.onboarding.monthlyJobs", { count: typeof selectedPlan.entitlements.max_prints_per_period === "number" ? formatNumber(selectedPlan.entitlements.max_prints_per_period) : t("billing.unlimited") })}</p>}
      <Field label={t("v4.onboarding.term")} htmlFor="request-term"><Select id="request-term" value={term} onChange={event => setTerm(event.target.value)} disabled={busy}><option value="monthly">{t("v4.onboarding.monthly")}</option><option value="yearly">{t("v4.onboarding.yearly")}</option></Select></Field>
      <Button type="submit" variant="primary" disabled={busy || !selectedPlan} loading={busy}>{t("v4.subscription.submitRequest")}</Button>
      {plans.length === 0 && <p className="text-sm text-ink-3">{t("onboarding.noPlansBody")}</p>}
    </form></>}
    {error && <Callout tone="bad" title={t("errors.operationFailed")}>{error}</Callout>}
  </div>;
}
