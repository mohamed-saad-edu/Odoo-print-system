"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, CardHeader, ErrorState, Field, Input } from "./ui";
import { useI18n } from "../i18n/react";
import { fetchWithTimeout } from "../lib/fetch-timeout";
import { useRouter } from "next/navigation";
import { SESSION_REVOCATION_EVENT } from "../lib/session-events";

type Session = { id: string; kind: "customer" | "manager" | "platform"; tenantId: string | null; tenantName: string | null;
  current: boolean; requiresPlatformStepUp: boolean; createdAt: string; lastRefreshedAt: string; expiresAt: string;
  ipAddress: string | null; userAgent: string | null };
type Page = { sessions: Session[]; truncated: boolean; nextCursor: string | null };
type Action = "revoke" | "revoke_others" | "revoke_all";

export function SessionInventory({ platform = false, canRevoke = true }: { platform?: boolean; canRevoke?: boolean }) {
  const router = useRouter();
  const { t, formatDate } = useI18n();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [confirmAll, setConfirmAll] = useState(false);
  const [platformStepUp, setPlatformStepUp] = useState(false);
  const generation = useRef(0);
  const currentRead = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const actionInFlight = useRef(false);
  const mounted = useRef(false);
  const endpoint = platform ? "/api/platform/auth/sessions" : "/api/auth/sessions";
  const load = useCallback(async (cursor: string | null, signal: AbortSignal): Promise<Page> => {
    const response = await fetchWithTimeout(endpoint + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""), {
      credentials: "include", cache: "no-store", signal,
    });
    const body = await response.json();
    if (!response.ok || !Array.isArray(body.sessions) || body.sessions.length > 100) throw new Error(t("security.sessionsFailed"));
    return body as Page;
  }, [endpoint, t]);
  const readPage = useCallback(async (cursor: string | null, number: number, controller: AbortController, ownGeneration: number) => {
    try {
      const body = await load(cursor, controller.signal);
      if (!mounted.current || controller.signal.aborted || generation.current !== ownGeneration) return;
      // Pagination replaces the current page: the renderer retains at most
      // 100 device records, even for an account with a long session history.
      setSessions(body.sessions); setNextCursor(body.nextCursor); setPageNumber(number);
    } catch (err) {
      if (mounted.current && !controller.signal.aborted && generation.current === ownGeneration) setError(t("security.sessionsFailed"));
    } finally {
      if (mounted.current && generation.current === ownGeneration) setLoading(false);
    }
  }, [load, t]);
  const showPage = useCallback((cursor: string | null, number: number) => {
    currentRead.current?.abort();
    const controller = new AbortController(); currentRead.current = controller;
    const ownGeneration = ++generation.current;
    setLoading(true); setError("");
    return readPage(cursor, number, controller, ownGeneration);
  }, [readPage]);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController(); currentRead.current = controller;
    const ownGeneration = ++generation.current;
    // Initial loading is already state=true. Only the asynchronous response
    // updates render state; effect replay still cancels the obsolete read.
    void readPage(null, 1, controller, ownGeneration);
    const refreshed = () => { if (!actionInFlight.current) void showPage(null, 1); };
    window.addEventListener("yaseir:workspace-reauthenticated", refreshed);
    return () => {
      mounted.current = false; generation.current += 1;
      currentRead.current?.abort(); actionController.current?.abort();
      window.removeEventListener("yaseir:workspace-reauthenticated", refreshed);
    };
  }, [readPage, showPage]);
  async function revoke(action: Action, id?: string) {
    if (actionInFlight.current || !canRevoke || (!platform && !password) || (action === "revoke_all" && !confirmAll)) return;
    actionInFlight.current = true; setBusy(true); setError(""); setPlatformStepUp(false);
    currentRead.current?.abort(); generation.current += 1; setLoading(false);
    const controller = new AbortController(); actionController.current = controller;
    try {
      const response = await fetchWithTimeout(endpoint, { method: "POST", credentials: "include", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(id ? { id } : {}), ...(!platform ? { password } : {}) }) });
      const data = await response.json();
      if (!mounted.current || controller.signal.aborted) return;
      if (!response.ok) {
        if (data.code === "PLATFORM_SESSION_STEP_UP_REQUIRED") {
          setPlatformStepUp(true); setError(t("security.platformSessionStepUp")); return;
        }
        setError(t("security.sessionsFailed")); return;
      }
      // The committed account sweep consumes pre-existing management
      // challenges, including this device's. Publish no credential or ID.
      window.dispatchEvent(new Event(SESSION_REVOCATION_EVENT));
      if (data.signedOut) { router.replace(platform ? "/platform/login" : "/login"); router.refresh(); return; }
      await showPage(null, 1);
    } catch (err) {
      if (mounted.current && !controller.signal.aborted) setError(t("security.sessionsFailed"));
    } finally {
      actionInFlight.current = false;
      if (mounted.current) { setBusy(false); setPassword(""); setConfirmAll(false); }
    }
  }
  const enabled = canRevoke && (platform || password.length > 0);
  const kindLabel = (kind: Session["kind"]) => t(kind === "platform" ? "security.sessionPlatform" : kind === "manager" ? "security.sessionManager" : "security.sessionCustomer");
  return <Card data-testid="session-inventory">
    <CardHeader title={t("security.sessions")} subtitle={t(platform ? "security.platformSessionsHint" : "security.workspaceSessionsHint")} />
    <div className="space-y-4 p-5" aria-busy={loading || busy}>
      {error && <ErrorState title={t("security.sessionsFailed")} message={error} />}
      {platformStepUp && <Link href="/platform/security" className="text-sm font-semibold underline">{t("security.openPlatformSecurity")}</Link>}
      {!platform && <Field label={t("security.confirmPassword")} htmlFor="session-password">
        <Input id="session-password" type="password" autoComplete="current-password" maxLength={4096} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} />
      </Field>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" disabled={!enabled || busy || loading} onClick={() => void revoke("revoke_others")}>{t("security.revokeOthers")}</Button>
        <Button id="session-revoke-all" type="button" variant="secondary" disabled={!enabled || busy || loading || !confirmAll} onClick={() => void revoke("revoke_all")}>{t("security.revokeAll")}</Button>
      </div>
      <label className="flex items-start gap-2 text-sm text-ink-3">
        <input id="session-confirm-all" type="checkbox" checked={confirmAll} disabled={busy} onChange={e => setConfirmAll(e.target.checked)} />
        <span>{t("security.confirmRevokeAll")}</span>
      </label>
      {loading && <p role="status" className="text-sm text-ink-3">{t("security.loadingSessions")}</p>}
      <ul className="divide-y divide-edge">
        {sessions.map(session => <li key={session.id} className="flex flex-wrap items-start justify-between gap-4 py-4">
          <div className="min-w-0 space-y-1 text-sm">
            <p className="font-semibold">{session.current ? t("security.currentSession") : t("security.otherSession")}</p>
            <p className="break-words text-ink-3">{kindLabel(session.kind)}{session.tenantName ? ` · ${session.tenantName}` : ""}</p>
            <p className="max-w-xl break-words text-ink-3">{session.userAgent || t("security.unknownDevice")}</p>
            {session.ipAddress && <p className="text-ink-3" dir="ltr">{session.ipAddress}</p>}
            <p className="text-ink-3">{t("security.sessionCreated")}: {formatDate(session.createdAt)} · {t("security.sessionExpires")}: {formatDate(session.expiresAt)}</p>
            {session.requiresPlatformStepUp && <Link href="/platform/security" className="block text-ink-3 underline">{t("security.platformSessionStepUp")}</Link>}
          </div>
          <Button type="button" variant="secondary" disabled={!enabled || busy || loading} onClick={() => void revoke("revoke", session.id)}>{t("security.revoke")}</Button>
        </li>)}
      </ul>
      <div className="flex flex-wrap gap-3">
        {pageNumber > 1 && <Button type="button" variant="secondary" disabled={busy || loading} onClick={() => void showPage(null, 1)}>{t("security.firstSessions")}</Button>}
        {nextCursor && <Button id="session-next-page" type="button" variant="secondary" disabled={busy || loading} onClick={() => void showPage(nextCursor, pageNumber + 1)}>{t("security.nextSessions")}</Button>}
      </div>
    </div>
  </Card>;
}
