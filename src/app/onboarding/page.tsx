"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, Clock, Download, KeyRound, Printer, Server } from "lucide-react";
import { useI18n } from "../../i18n/react";
import { fetchWithTimeout } from "../../lib/fetch-timeout";
import { ensureCustomerSession } from "../../lib/session-config";
import { codeMessageKey } from "../../lib/api-error-keys";
import { Button, Callout, Card, CardHeader, ErrorState, Field, Input, Skeleton, StatusBadge } from "../../components/ui";

type Plan = { id: string; name: string; entitlements: Record<string, unknown> };
type ActivationRequest = { id: string; reference: string; status: string; createdAt: string; planId: string; term: string; whatsappUrl?: string | null };
type WorkspaceState = { tenant: { id: string; name: string }; role: string; plans: Plan[]; agentDownloadUrl?: string | null; subscription?: { planId: string } | null };
type RequestState = { requests: ActivationRequest[]; status: "awaiting_activation" | "active" | "expired" | "suspended" };

export default function Onboarding() {
  const { t, formatNumber, formatDateTime } = useI18n();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [state, setState] = useState<RequestState | null>(null);
  const [name, setName] = useState("");
  const [planId, setPlanId] = useState("");
  const [term, setTerm] = useState<"monthly" | "yearly">("monthly");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  const loadGeneration = useRef(0);
  const requestKey = useRef<{ fingerprint: string; key: string } | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const generation = ++loadGeneration.current;
    try {
      if (!(await ensureCustomerSession()).authenticated) { router.replace("/login?next=%2Fonboarding"); return; }
      const responses = await Promise.all(["/api/onboarding", "/api/subscription-requests"].map(url => fetchWithTimeout(url, { credentials: "include", cache: "no-store", signal })));
      if (responses.some(response => !response.ok)) throw new Error();
      const [nextWorkspace, nextState] = await Promise.all(responses.map(response => response.json())) as [WorkspaceState, RequestState];
      if (signal?.aborted || generation !== loadGeneration.current) return;
      setWorkspace(nextWorkspace); setState(nextState); setError("");
      setName(current => current || nextWorkspace.tenant.name);
      setPlanId(current => current || nextWorkspace.subscription?.planId || nextWorkspace.plans.find(plan => plan.id === new URLSearchParams(window.location.search).get("plan"))?.id || nextWorkspace.plans[0]?.id || "");
    } catch { if (!signal?.aborted && generation === loadGeneration.current) setError(t("v4.onboarding.loadFailed")); }
    finally { if (!signal?.aborted && generation === loadGeneration.current) setLoading(false); }
  }, [router, t]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal); });
    return () => controller.abort();
  }, [load]);

  // Pending users can keep this page open; activation becomes visible without a new login.
  useEffect(() => {
    if (!state || state.status === "active") return;
    const controller = new AbortController();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(controller.signal); }, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [state, load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (flight.current || workspace?.role !== "owner") return;
    flight.current = true; setBusy(true); setError("");
    try {
      const saved = await fetchWithTimeout("/api/onboarding", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceName: name.trim(), planId }) });
      const savedBody = await saved.json().catch(() => ({}));
      if (!saved.ok) { setError(t(codeMessageKey(savedBody.code) ?? "v4.onboarding.failed")); return; }
      const fingerprint = `${planId}:${term}`;
      if (requestKey.current?.fingerprint !== fingerprint) requestKey.current = { fingerprint, key: crypto.randomUUID() };
      const response = await fetchWithTimeout("/api/subscription-requests", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey.current.key }, body: JSON.stringify({ planId, term }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(t(codeMessageKey(data.code) ?? "v4.onboarding.failed")); return; }
      await load();
    } catch { setError(t("v4.onboarding.failed")); }
    finally { flight.current = false; setBusy(false); }
  }

  const request = state?.requests.find(item => item.status === "pending") ?? state?.requests[0];
  const pending = request?.status === "pending";
  const active = state?.status === "active";
  const owner = workspace?.role === "owner";
  const steps = [
    { icon: Download, title: "v4.onboarding.download", body: "v4.onboarding.downloadBody", href: workspace?.agentDownloadUrl ?? "" },
    { icon: Server, title: "v4.onboarding.pair", body: "v4.onboarding.pairBody", href: "/dashboard#agents" },
    { icon: Printer, title: "v4.onboarding.printers", body: "v4.onboarding.printersBody", href: "/dashboard#printers" },
    { icon: KeyRound, title: "v4.onboarding.odoo", body: "v4.onboarding.odooBody", href: "/api-keys" },
  ] as const;
  return <main className="ambient-surface min-h-screen px-4 py-10 sm:px-6">
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-3">
        <StatusBadge tone={active ? "ok" : "warn"} label={t(active ? "v4.onboarding.active" : state?.status === "expired" ? "v4.onboarding.expired" : state?.status === "suspended" ? "v4.onboarding.suspended" : "v4.onboarding.pending")} />
        <h1 className="text-3xl font-semibold text-ink">{t(active ? "v4.onboarding.ready" : pending ? "v4.onboarding.requestReceived" : "v4.onboarding.title")}</h1>
        <p className="text-base leading-relaxed text-ink-3">{t(active ? "v4.onboarding.readyBody" : "v4.onboarding.intro")}</p>
      </header>
      {error && <ErrorState title={t("errors.operationFailed")} message={error} retry={() => void load()} />}
      {loading ? <div role="status" aria-label={t("common.loading")} className="space-y-3"><Skeleton className="h-28 w-full" /><Skeleton className="h-48 w-full" /></div> : active ? <>
        <Button href="/dashboard" variant="primary">{t("v4.onboarding.start")}</Button>
        <Card><CardHeader title={workspace?.tenant.name ?? ""} icon={<CheckCircle2 className="h-5 w-5" />} />
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-5 py-4 font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35">{t("v4.experience.setup.title")}</summary>
            <ol className="divide-y divide-edge-subtle border-t border-edge-subtle">{steps.map((step, index) => <li key={step.title} className="flex flex-wrap items-center gap-4 p-5"><step.icon className="h-5 w-5 text-brand" aria-hidden /><div className="min-w-48 flex-1"><h2 className="font-semibold">{formatNumber(index + 1)}. {t(step.title)}</h2><p className="mt-1 text-sm text-ink-3">{t(step.body)}</p></div><Button href={step.href || undefined} disabled={!step.href} variant="secondary">{t(step.href ? "common.continue" : "v4.onboarding.downloadUnavailable")}</Button></li>)}</ol>
          </details>
        </Card>
      </> : workspace && state ? <>
        {(pending || !owner || state.status === "suspended") ? <Card><CardHeader title={workspace.tenant.name} icon={<Clock className="h-5 w-5" />} /><div className="space-y-4 p-5">
          <h2 className="text-xl font-semibold">{t(state.status === "suspended" ? "v4.onboarding.suspended" : "v4.onboarding.wait")}</h2>
          <p className="leading-relaxed text-ink-3">{t(owner ? "v4.onboarding.waitBody" : "v4.onboarding.memberWait")}</p>
          {request && <dl className="space-y-2 text-sm"><div><dt className="text-ink-3">{t("v4.onboarding.reference")}</dt><dd dir="ltr" className="break-all font-mono text-start">{request.reference}</dd></div><div><dt className="text-ink-3">{t("v4.onboarding.requestedAt")}</dt><dd>{formatDateTime(request.createdAt)}</dd></div></dl>}
          <div className="flex flex-wrap gap-3">{request?.whatsappUrl && <Button href={request.whatsappUrl} variant="primary" target="_blank" rel="noopener noreferrer">{t("v4.onboarding.whatsapp")}</Button>}<Button variant="secondary" onClick={() => void load()}>{t("v4.onboarding.refresh")}</Button><Button variant="ghost" href="/settings">{t("v4.onboarding.account")}</Button></div>
          {owner && !request?.whatsappUrl && <p className="text-sm text-ink-3">{t("v4.onboarding.contactUnavailable")}</p>}
        </div></Card> : <Card><CardHeader title={t("v4.onboarding.companyPlan")} icon={<Building2 className="h-5 w-5" />} /><form onSubmit={submit} className="space-y-6 p-5">
          <Field label={t("onboarding.workspaceName")} htmlFor="workspace-name" required><Input id="workspace-name" value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={120} autoComplete="organization" disabled={busy} /></Field>
          <fieldset disabled={busy}><legend className="mb-3 font-semibold">{t("onboarding.choosePlanLegend")}</legend><div className="grid gap-3 sm:grid-cols-2">{workspace.plans.map(plan => <label key={plan.id} className={`flex min-h-28 cursor-pointer gap-3 rounded-md border p-4 focus-within:ring-2 focus-within:ring-brand ${planId === plan.id ? "border-brand bg-brand-subtle" : "border-edge"}`}><input type="radio" name="plan" value={plan.id} checked={planId === plan.id} onChange={() => setPlanId(plan.id)} required /><span><span className="block font-semibold">{plan.name}</span><span className="mt-2 block text-sm text-ink-3">{t("v4.onboarding.monthlyJobs", { count: typeof plan.entitlements.max_prints_per_period === "number" ? formatNumber(plan.entitlements.max_prints_per_period) : t("billing.unlimited") })}</span></span></label>)}</div>{workspace.plans.length === 0 && <p>{t("onboarding.noPlansBody")}</p>}</fieldset>
          <fieldset disabled={busy}><legend className="mb-3 font-semibold">{t("v4.onboarding.term")}</legend><div className="flex flex-wrap gap-4">{(["monthly", "yearly"] as const).map(value => <label key={value} className="flex min-h-11 items-center gap-2"><input type="radio" name="term" checked={term === value} onChange={() => setTerm(value)} />{t(value === "monthly" ? "v4.onboarding.monthly" : "v4.onboarding.yearly")}</label>)}</div><p className="text-sm text-ink-3">{t("v4.onboarding.monthlyReset")}</p></fieldset>
          <Callout tone="info" title={t("v4.onboarding.manualTitle")}>{t("v4.onboarding.manualBody")}</Callout>
          <Button type="submit" variant="primary" loading={busy} disabled={busy || name.trim().length < 2 || !workspace.plans.some(plan => plan.id === planId)}>{t("v4.onboarding.request")}</Button>
        </form></Card>}
      </> : null}
    </div>
  </main>;
}
