"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Button, Callout, Card, CardHeader, Field, Input } from "./ui";
import { useI18n } from "../i18n/react";
import { apiMessageKey } from "../lib/api-error-keys";
import { fetchWithTimeout, WORKSPACE_REAUTHENTICATION_EVENT } from "../lib/fetch-timeout";
import type { MessageKey } from "../i18n/messages/en";

const REAUTHENTICATED_EVENT = "yaseir:workspace-reauthenticated";
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
const WORKSPACE_ROUTES = ["/onboarding", "/dashboard", "/api-keys", "/team", "/billing", "/settings"];
type ActivityBudget = { lastSent: number | null };

/** Only explicit navigation to a known same-origin workspace UI is allowed. */
export function safeWorkspaceReturnPath(value: string | null, origin: string): string | null {
  if (!value || value.length > 4096 || value !== value.trim() || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const base = new URL(origin);
    const url = new URL(value, base);
    if (!["https:", "http:"].includes(base.protocol) || url.origin !== base.origin || url.username || url.password) return null;
    // Validate escapes as well as the URL parser's normalized path. Encoded
    // path separators must not turn a UI path into an API/auth destination.
    decodeURIComponent(url.pathname);
    if (/%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(url.pathname)) return null;
    if (!WORKSPACE_ROUTES.some(route => url.pathname === route || url.pathname.startsWith(route + "/"))) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

/** A foreground input hint, never a background keepalive or fresh proof. */
export function observeWorkspaceActivity(
  target: Document,
  onExpired: () => void,
  now: () => number = () => performance.now(),
  budget: ActivityBudget = { lastSent: null },
): () => void {
  let disposed = false;
  let expired = false;
  let flight: AbortController | null = null;
  const onActivity = (event: Event) => {
    if (disposed || expired || !event.isTrusted || target.visibilityState !== "visible" || flight) return;
    const at = now();
    if (budget.lastSent !== null && at - budget.lastSent < 60_000) return;
    budget.lastSent = at;
    const controller = new AbortController();
    flight = controller;
    void fetchWithTimeout("/api/auth/activity", {
      method: "POST", credentials: "same-origin", mode: "same-origin", cache: "no-store",
      redirect: "error", signal: controller.signal,
    }, 10_000).then(response => {
      if (!disposed && !controller.signal.aborted && response.status === 401) {
        expired = true;
        onExpired();
      }
    }).catch(() => {
      // An outage does not establish expiry. Another trusted input after the
      // throttle window may try again; elapsed time alone never sends a call.
    }).finally(() => { if (flight === controller) flight = null; });
  };
  for (const type of ACTIVITY_EVENTS) target.addEventListener(type, onActivity, { passive: true });
  return () => {
    disposed = true;
    flight?.abort();
    for (const type of ACTIVITY_EVENTS) target.removeEventListener(type, onActivity);
  };
}

/** Mounted only inside the authenticated workspace shell. */
export function WorkspaceSecurityNotice() {
  const { t } = useI18n();
  const [notice, setNotice] = useState<{ expired: boolean; href: string } | null>(null);
  useEffect(() => {
    const expire = () => setNotice({ expired: true, href: "/login?next=%2Fsettings" });
    const budget: ActivityBudget = { lastSent: null };
    let stopActivity = observeWorkspaceActivity(document, expire, undefined, budget);
    const required = () => {
      const returnTo = safeWorkspaceReturnPath(window.location.pathname + window.location.search + window.location.hash, window.location.origin);
      setNotice(current => current?.expired ? current : { expired: false, href: "/settings?reauth=1" + (returnTo ? "&returnTo=" + encodeURIComponent(returnTo) : "") + "#workspace-security" });
    };
    const confirmed = () => {
      setNotice(null);
      stopActivity();
      stopActivity = observeWorkspaceActivity(document, expire, undefined, budget);
    };
    window.addEventListener(WORKSPACE_REAUTHENTICATION_EVENT, required);
    window.addEventListener(REAUTHENTICATED_EVENT, confirmed);
    return () => {
      stopActivity();
      window.removeEventListener(WORKSPACE_REAUTHENTICATION_EVENT, required);
      window.removeEventListener(REAUTHENTICATED_EVENT, confirmed);
    };
  }, []);
  if (!notice) return null;
  return <div data-testid="workspace-reauthentication-notice" className="px-4 pt-4 sm:px-6">
    <Callout tone={notice.expired ? "bad" : "warn"} title={t(notice.expired ? "workspaceSecurity.sessionExpiredTitle" : "workspaceSecurity.title")}
      action={<Link href={notice.href} prefetch={false} className="font-semibold underline underline-offset-4">{t(notice.expired ? "workspaceSecurity.signIn" : "workspaceSecurity.openSettings")}</Link>}>
      {t(notice.expired ? "errors.sessionExpired" : "workspaceSecurity.required")}
    </Callout>
  </div>;
}

type Expiry = { stepUpExpiresAt: string | null; idleExpiresAt: string; absoluteExpiresAt: string };
type Snapshot = Expiry & { kind: "customer" | "manager"; reauthenticationRequired: boolean };
type Feedback = { key: MessageKey; ok: boolean };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}
function expiry(value: Record<string, unknown> | null): Expiry | null {
  if (!value || (value.stepUpExpiresAt !== null && !validDate(value.stepUpExpiresAt)) || !validDate(value.idleExpiresAt) || !validDate(value.absoluteExpiresAt)) return null;
  return { stepUpExpiresAt: value.stepUpExpiresAt as string | null, idleExpiresAt: value.idleExpiresAt, absoluteExpiresAt: value.absoluteExpiresAt };
}
function responseKey(body: Record<string, unknown> | null, status: number, fallback: MessageKey): MessageKey {
  if (status === 401) return "errors.sessionExpired";
  return apiMessageKey(typeof body?.code === "string" ? body.code : undefined, status, fallback);
}

export function WorkspaceSecurity() {
  const { t, formatDateTime } = useI18n();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState<MessageKey | null>(null);
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const mounted = useRef(false);
  const statusRequest = useRef<AbortController | null>(null);
  const confirmation = useRef<AbortController | null>(null);

  const loadStatus = useCallback(async () => {
    if (statusRequest.current || confirmation.current) return null;
    const controller = new AbortController();
    statusRequest.current = controller;
    try {
      const response = await fetchWithTimeout("/api/auth/reauth/status", {
        credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
      });
      const body = record(await response.json().catch(() => null));
      if (!mounted.current || controller.signal.aborted || statusRequest.current !== controller) return null;
      if (!response.ok) {
        setExpired(response.status === 401);
        if (response.status === 401) setSnapshot(null);
        setStatusError(responseKey(body, response.status, "workspaceSecurity.statusUnavailable"));
        return null;
      }
      const times = expiry(body);
      if (!times || (body?.kind !== "customer" && body?.kind !== "manager") || typeof body?.reauthenticationRequired !== "boolean") {
        setStatusError("workspaceSecurity.statusUnavailable");
        return null;
      }
      const next: Snapshot = { ...times, kind: body.kind, reauthenticationRequired: body.reauthenticationRequired };
      setSnapshot(next);
      setStatusError(null);
      setExpired(false);
      return next;
    } catch {
      if (mounted.current && !controller.signal.aborted && statusRequest.current === controller) setStatusError("workspaceSecurity.networkUnavailable");
    } finally {
      if (statusRequest.current === controller) {
        statusRequest.current = null;
        if (mounted.current) setLoading(false);
      }
    }
    return null;
  }, []);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    // Begin the read after commit. Effect cleanup can cancel a setup that React
    // replays before the request begins, without a synchronous state cascade.
    void Promise.resolve().then(() => { if (active) return loadStatus(); });
    return () => {
      active = false;
      mounted.current = false;
      statusRequest.current?.abort();
      confirmation.current?.abort();
      statusRequest.current = null;
      confirmation.current = null;
    };
  }, [loadStatus]);

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (confirmation.current || statusRequest.current || expired || !mounted.current) return;
    const exactPassword = password;
    setPassword("");
    setReturnTo(null);
    if (!exactPassword || exactPassword.length > 4096) {
      setFeedback({ key: "workspaceSecurity.passwordLength", ok: false });
      return;
    }
    const controller = new AbortController();
    confirmation.current = controller;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetchWithTimeout("/api/auth/reauth/password", {
        method: "POST", credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: exactPassword }), signal: controller.signal,
      });
      const body = record(await response.json().catch(() => null));
      if (!mounted.current || controller.signal.aborted || confirmation.current !== controller) return;
      if (!response.ok) {
        if (response.status === 401) { setExpired(true); setSnapshot(null); }
        setFeedback({ key: responseKey(body, response.status, "workspaceSecurity.confirmationFailed"), ok: false });
        return;
      }
      const times = expiry(body);
      if (!snapshot || body?.kind !== snapshot.kind || body?.ok !== true || !validDate(body.expiresAt) || !times?.stepUpExpiresAt) {
        setFeedback({ key: "workspaceSecurity.confirmationFailed", ok: false });
        return;
      }
      setSnapshot({ ...times, kind: snapshot.kind, reauthenticationRequired: false });
      setStatusError(null);
      setFeedback({ key: "workspaceSecurity.confirmed", ok: true });
      setReturnTo(safeWorkspaceReturnPath(new URLSearchParams(window.location.search).get("returnTo"), window.location.origin));
      // Only public UI state changes. Cookies are issued by the server; neither
      // credentials nor an original mutation are retained for replay.
      try { window.dispatchEvent(new Event(REAUTHENTICATED_EVENT)); } catch { /* optional UI notification */ }
    } catch {
      if (mounted.current && !controller.signal.aborted && confirmation.current === controller) setFeedback({ key: "workspaceSecurity.networkUnavailable", ok: false });
    } finally {
      if (confirmation.current === controller) {
        confirmation.current = null;
        if (mounted.current) { setPassword(""); setBusy(false); }
      }
    }
  }

  return <section id="workspace-security" aria-labelledby="workspace-security-title" className="scroll-mt-6">
    <Card>
      <CardHeader title={<span id="workspace-security-title">{t("workspaceSecurity.title")}</span>} subtitle={t("workspaceSecurity.description")} icon={<ShieldCheck className="h-4 w-4" />} />
      <div className="space-y-4 p-5">
        {loading && <p role="status" className="text-sm text-ink-3">{t("workspaceSecurity.checking")}</p>}
        {statusError && <Callout tone="bad" title={t("workspaceSecurity.statusTitle")}
          action={!expired && <Button type="button" size="sm" variant="secondary" disabled={loading || busy} onClick={() => {
            if (statusRequest.current || confirmation.current) return;
            setLoading(true); void loadStatus();
          }}>{t("common.retry")}</Button>}>
          {t(statusError)}
        </Callout>}
        {snapshot && <>
          <p className="text-sm text-ink-3">{t(snapshot.reauthenticationRequired ? "workspaceSecurity.required" : "workspaceSecurity.ready")}</p>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {snapshot.stepUpExpiresAt && <div><dt className="text-ink-3">{t("workspaceSecurity.confirmationExpires")}</dt><dd className="mt-1 font-medium">{formatDateTime(snapshot.stepUpExpiresAt)}</dd></div>}
            <div><dt className="text-ink-3">{t("workspaceSecurity.idleExpires")}</dt><dd className="mt-1 font-medium">{formatDateTime(snapshot.idleExpiresAt)}</dd></div>
            <div><dt className="text-ink-3">{t("workspaceSecurity.absoluteExpires")}</dt><dd className="mt-1 font-medium">{formatDateTime(snapshot.absoluteExpiresAt)}</dd></div>
          </dl>
          <p className="text-xs leading-relaxed text-ink-3">{t("workspaceSecurity.expiryHint")}</p>
        </>}
        <form method="post" onSubmit={confirm} className="space-y-4">
          <Field label={t("workspaceSecurity.password")} htmlFor="workspace-confirm-password" required>
            <Input id="workspace-confirm-password" type="password" autoComplete="current-password" value={password} maxLength={4096} required
              disabled={busy || loading || expired} onChange={event => setPassword(event.target.value)} />
          </Field>
          {feedback && <div data-testid="workspace-security-result"><Callout tone={feedback.ok ? "ok" : "bad"} title={t(feedback.ok ? "workspaceSecurity.confirmed" : "workspaceSecurity.confirmationFailed")}>
            {t(feedback.ok ? "workspaceSecurity.reviewTask" : feedback.key)}
          </Callout></div>}
          <div className="flex flex-wrap items-center gap-3">
            <Button id="workspace-confirm-identity" type="submit" variant="primary" loading={busy} disabled={busy || loading || expired || password.length === 0}>{t(busy ? "workspaceSecurity.confirming" : "workspaceSecurity.confirm")}</Button>
            {feedback?.ok && returnTo && <Link id="workspace-return-to-task" href={returnTo} prefetch={false} className="font-semibold text-brand underline underline-offset-4">{t("workspaceSecurity.returnToTask")}</Link>}
            {expired && <Link href="/login?next=%2Fsettings" prefetch={false} className="font-semibold text-brand underline underline-offset-4">{t("workspaceSecurity.signIn")}</Link>}
          </div>
        </form>
      </div>
    </Card>
  </section>;
}
