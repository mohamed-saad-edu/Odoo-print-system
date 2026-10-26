"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, Card, CardHeader, ErrorState, Field, Input, PageHeader, Callout } from "../../../components/ui";
import { SessionInventory } from "../../../components/SessionInventory";
import { useI18n } from "../../../i18n/react";
import { fetchWithTimeout } from "../../../lib/fetch-timeout";
import { SESSION_REVOCATION_EVENT } from "../../../lib/session-events";
import { apiMessageKey } from "../../../lib/api-error-keys";

export default function PlatformSecurityPage() {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [freshUntil, setFreshUntil] = useState(0);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const mounted = useRef(false);
  const flight = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    const invalidated = () => {
      flight.current?.abort(); flight.current = null;
      setFreshUntil(0); setPassword(""); setBusy(false);
    };
    window.addEventListener(SESSION_REVOCATION_EVENT, invalidated);
    return () => { mounted.current = false; flight.current?.abort(); flight.current = null; window.removeEventListener(SESSION_REVOCATION_EVENT, invalidated); };
  }, []);
  useEffect(() => {
    if (!freshUntil) return;
    const timer = setTimeout(() => setFreshUntil(0),Math.max(0,freshUntil-Date.now()));
    return () => clearTimeout(timer);
  }, [freshUntil]);

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!mounted.current || flight.current || expired) return;
    const exactPassword = password; setPassword("");
    if (!exactPassword || exactPassword.length > 4096) { setError(t("workspaceSecurity.passwordLength")); return; }
    const controller = new AbortController(); flight.current = controller;
    setBusy(true); setError(""); setFreshUntil(0);
    try {
      const response = await fetchWithTimeout("/api/platform/auth/reauth", {
        method: "POST",credentials: "same-origin",mode: "same-origin",cache: "no-store",redirect: "error",
        headers: { "Content-Type": "application/json" },body: JSON.stringify({ password: exactPassword }),signal: controller.signal,
      });
      const body = await response.json().catch(() => null);
      if (!mounted.current || controller.signal.aborted || flight.current !== controller) return;
      if (!response.ok) {
        if (response.status === 401) setExpired(true);
        setError(t(apiMessageKey(typeof body?.code === "string" ? body.code : undefined,response.status,"workspaceSecurity.confirmationFailed")));
        return;
      }
      const expiry = typeof body?.stepUpExpiresAt === "string" ? Date.parse(body.stepUpExpiresAt) : NaN;
      if (body?.ok !== true || body.reauthenticationRequired !== false || !Number.isFinite(expiry) || expiry<=Date.now()) {
        setError(t("workspaceSecurity.confirmationFailed")); return;
      }
      setFreshUntil(expiry);
    } catch {
      if (mounted.current && !controller.signal.aborted && flight.current === controller) setError(t("errors.networkError"));
    } finally {
      if (flight.current === controller) { flight.current = null; if (mounted.current) { setBusy(false); setPassword(""); } }
    }
  }
  const fresh = freshUntil > 0;
  return <div className="space-y-6">
    <nav className="flex flex-wrap gap-4"><Link href="/platform/audit" className="underline">{t("platform.nav.audit")}</Link><Link href="/platform/database" className="underline">{t("platform.nav.database")}</Link></nav>
    <PageHeader variant="inline" title={t("security.title")}  />
    {error && <ErrorState title={t("security.settingsFailed")} message={error} />}
    <Card><CardHeader title={t("security.stepUpTitle")} subtitle={t("security.stepUpDescription")} /><div className="space-y-4 p-5">
      {fresh && <Callout tone="ok" title={t("security.stepUpReady")}>{t("security.stepUpWindow")}</Callout>}
      <form onSubmit={confirm} className="space-y-3">
        <Field label={t("security.confirmPassword")} htmlFor="security-password" required>
          <Input id="security-password" type="password" autoComplete="current-password" value={password} maxLength={4096}
            disabled={busy || expired} onChange={event => setPassword(event.target.value)} required />
        </Field>
        <Button type="submit" loading={busy} disabled={busy || expired || !password}>{t("common.continue")}</Button>
        {expired && <Link href="/platform/login" prefetch={false} className="ms-3 font-semibold underline">{t("workspaceSecurity.signIn")}</Link>}
      </form>
    </div></Card>
    <SessionInventory platform canRevoke={fresh} />
  </div>;
}
