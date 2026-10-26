"use client";

import { fetchWithTimeout } from "../../lib/fetch-timeout";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Building2, ShieldCheck } from "lucide-react";
import { AuthShell } from "../../components/AuthShell";
import { Button, Field, Input, ErrorState, Skeleton } from "../../components/ui";
import { ensureCustomerSession } from "../../lib/session-config";
import { codeMessageKey } from "../../lib/api-error-keys";

import type { MessageKey } from "../../i18n/messages/en";

class LoginRequestError extends Error {
  constructor(readonly key: MessageKey) { super(key); }
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name?: string }>>([]);
  const [selectionToken, setSelectionToken] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const flight = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const router = useRouter();

  const postAuthDestination = useCallback((): string => {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next && next.startsWith("/") && !/[\\\u0000-\u001f\u007f]/.test(next)) {
      try {
        const destination = new URL(next, window.location.origin);
        if (destination.origin === window.location.origin && !["/login", "/logout", "/register"].includes(destination.pathname)) return destination.pathname + destination.search + destination.hash;
      } catch { /* use the safe workspace destination */ }
    }
    return "/dashboard";
  }, []);

  useEffect(() => {
    let cancelled = false;
    mounted.current = true;
    const startup = new AbortController();
    const cleanup = () => { cancelled = true; mounted.current = false; startup.abort(); flight.current?.abort(); flight.current = null; };
    // An invitation can be opened in a browser signed into a different
    // account. Force the credential form for an explicit account switch
    // rather than bouncing straight back to /invite in a redirect loop.
    if (new URLSearchParams(window.location.search).get("switch") === "1") {
      queueMicrotask(() => { if (!cancelled) setCheckingSession(false); });
      return cleanup;
    }
    ensureCustomerSession()
      .then((session) => {
        if (!cancelled && session.authenticated) router.replace(postAuthDestination());
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setCheckingSession(false);
      });
    return cleanup;
  }, [router, postAuthDestination, t]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (flight.current || !mounted.current) return;
    const exactPassword = password;
    setPassword("");
    const controller = new AbortController(); flight.current = controller;
    setErr("");
    setWorkspaces([]);
    setSelectionToken("");
    setLoading(true);
    try {
      const destination = new URL(postAuthDestination(), window.location.origin);
      const inviteToken = destination.pathname === "/invite" ? destination.searchParams.get("token") : null;
      const res = await fetchWithTimeout("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
        body: JSON.stringify({ email, password: exactPassword, ...(inviteToken ? { inviteToken } : {}) }), signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!mounted.current || controller.signal.aborted || flight.current !== controller) return;
      if (res.status === 409 && Array.isArray(data.workspaces)) {
        if (typeof data.selectionToken !== "string" || !data.selectionToken) {
          throw new LoginRequestError("auth.signIn.selectWorkspaceFailed");
        }
        const ids = data.workspaces.filter((id: unknown): id is string => typeof id === "string");
        const names = new Map<string, string>();
        if (Array.isArray(data.workspaceOptions)) {
          for (const option of data.workspaceOptions) {
            if (option && typeof option.id === "string" && typeof option.name === "string" && option.name.trim()) {
              names.set(option.id, option.name.trim());
            }
          }
        }
        setSelectionToken(data.selectionToken);
        // Membership IDs remain authoritative. Names are display metadata;
        // older gateways still work with their existing ID-only response.
        setWorkspaces(ids.map((id: string) => ({ id, name: names.get(id) })));
        return;
      }
      if (!res.ok) {
        throw new LoginRequestError(codeMessageKey(typeof data.code === "string" ? data.code : undefined)
          ?? (res.status === 429 ? "errors.tooManyAttempts" : res.status === 503 ? "errors.serviceUnavailable" : "auth.signIn.failed"));
      }
      router.replace(data.invitationAccepted === true ? "/dashboard" : postAuthDestination());
      router.refresh();
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && flight.current === controller) setErr(t(error instanceof LoginRequestError ? error.key : "errors.networkError"));
    } finally {
      if (flight.current === controller) { flight.current = null; if (mounted.current) { setPassword(""); setLoading(false); } }
    }
  }

  async function chooseWorkspace(tenantId: string) {
    if (flight.current || !mounted.current) return;
    const controller = new AbortController(); flight.current = controller;
    setLoading(true);
    setErr("");
    try {
      const res = await fetchWithTimeout("/api/auth/select-tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
        body: JSON.stringify({ tenantId, selectionToken }), signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!mounted.current || controller.signal.aborted || flight.current !== controller) return;
      if (!res.ok) {
        throw new LoginRequestError(codeMessageKey(typeof data.code === "string" ? data.code : undefined)
          ?? (res.status === 429 ? "errors.tooManyAttempts" : res.status === 503 ? "errors.serviceUnavailable" : "auth.signIn.selectWorkspaceFailed"));
      }
      router.replace(postAuthDestination());
      router.refresh();
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && flight.current === controller) setErr(t(error instanceof LoginRequestError ? error.key : "errors.networkError"));
    } finally {
      if (flight.current === controller) { flight.current = null; if (mounted.current) { setPassword(""); setLoading(false); } }
    }
  }

  if (checkingSession) {
    return (
      <AuthShell subtitle={t("auth.shell.gateway")}>
        <div className="space-y-4" role="status" aria-label={t("auth.session.checking")}>
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="mt-6 h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <span className="sr-only">{t("auth.session.checkingShort")}</span>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      subtitle={t("auth.shell.gateway")}
      eyebrow={t("auth.signIn.eyebrow")}
      title={t("auth.signIn.title")}
      description={t("auth.signIn.description")}
      footer={
        <>
          {t("auth.signIn.noAccount")}{" "}
          <Link href="/signup" className="font-[600] text-brand hover:text-brand-hover hover:underline">
            {t("auth.signIn.createOne")}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={t("auth.email")} htmlFor="email">
          <Input
            id="email"
            type="email"
            placeholder={t("auth.emailPlaceholder")}
            value={email}
            onChange={(e) => { setEmail(e.target.value); setWorkspaces([]); setSelectionToken(""); }}
            autoComplete="email"
            autoFocus
            disabled={loading}
            required
          />
        </Field>

        <Field
          label={t("auth.password")}
          htmlFor="password"
          actions={
            <Link
              href="/forgot-password"
              className="text-sm font-[550] text-ink-3 transition-colors hover:text-brand"
            >
              {t("auth.password.forgot")}
            </Link>
          }
        >
          <Input
            id="password"
            type="password"
            placeholder={t("auth.passwordPlaceholder")}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setWorkspaces([]); setSelectionToken(""); }}
            autoComplete="current-password"
            maxLength={4096}
            disabled={loading}
            required
          />
        </Field>

        {err && <ErrorState title={t("auth.signIn.failed")} message={err} />}

        {workspaces.length > 0 && (
          <div className="rounded-sg border border-edge-accent bg-brand-subtle p-4">
            <div className="flex items-center gap-2 text-sm font-[600] text-ink">
              <Building2 className="h-4 w-4 text-brand" aria-hidden />
              {t("auth.signIn.chooseWorkspace")}
            </div>
            <p className="mt-1 text-sm text-ink-2">
              {t("auth.signIn.chooseWorkspaceDescription")}
            </p>
            <div className="mt-3 grid gap-2">
              {workspaces.map(({ id, name }) => (
                <button
                  key={id}
                  type="button"
                  disabled={loading}
                  onClick={() => void chooseWorkspace(id)}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-sm border border-edge bg-surface px-3.5 py-2 text-start text-sm font-[550] text-ink transition-colors duration-150 hover:border-edge-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 disabled:opacity-50"
                >
                  <span className="min-w-0 break-words" title={id}>{name ?? t("auth.signIn.workspaceSuffix", { suffix: id.slice(-6) })}</span>
                  <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100 shrink-0 text-ink-4" aria-hidden />
                </button>
              ))}
            </div>
          </div>
        )}

        <Button
          variant="primary"
          type="submit"
          loading={loading}
          className="w-full"
          size="lg"
          icon={loading ? undefined : <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />}
        >
          {loading ? t("auth.signIn.submitting") : t("auth.signIn.title")}
        </Button>

        <div className="flex items-start gap-2.5 rounded-sg border border-edge-subtle bg-surface-2 px-3.5 py-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
          <p className="text-sm leading-relaxed text-ink-3">{t("auth.signIn.verifyEmailNote")}</p>
        </div>
      </form>
    </AuthShell>
  );
}
