"use client";

import { fetchWithTimeout } from "../../lib/fetch-timeout";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/react";
import type { Translator } from "../../i18n/translate";
import Link from "next/link";
import {
  ChevronDown,
  Copy,
  KeyRound,
  ShieldCheck,
  Plus,
  Trash2,
  Ban,
  RefreshCw,
} from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  Callout,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageContainer,
  PageHeader,
  StatusBadge,
  Skeleton,
  StatusDot,
  type Tone,
} from "../../components/ui";
import { ensureCustomerSession } from "../../lib/session-config";
import { codeMessageKey } from "../../lib/api-error-keys";
import { copyTextToClipboard } from "../../lib/clipboard";

type Installation = { id: string; name: string; enabled: boolean; api_key_ids: string[] };

type ApiKey = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  readOnlyUntil: string | null;
  rotationState: "active" | "retiring" | "revoked";
  odooEnabled: boolean;
  odooEnabledRevision: number;
  odooEnabledUpdatedAt: string | null;
};

function rotationMeta(key: ApiKey, t: Translator): { label: string; tone: Tone } {
  // Defensive: older API payloads may omit rotationState — a key that is not
  // revoked is active. Never render an undefined badge.
  if (key.rotationState === "retiring") return { label: t("apiKeys.retiring"), tone: "warn" };
  if (key.revokedAt || key.rotationState === "revoked") return { label: t("apiKeys.revoked"), tone: "neutral" };
  return { label: t("apiKeys.active"), tone: "ok" };
}

export default function ApiKeysPage() {
  const refreshEpoch = useRef(0);
  const mutationInFlight = useRef(false);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [gatewayUrl, setGatewayUrl] = useState("");
  const { t, tc, formatDate, formatDateTime, formatNumber } = useI18n();
  const [name, setName] = useState(t("apiKeys.defaultName"));
  const [rawKeyId, setRawKeyId] = useState<string | null>(null);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<{ kind: "revoke" | "remove" | "rotate"; id: string; name: string } | null>(null);
  const [hasSubscription, setHasSubscription] = useState<boolean | null>(null);

  const [loadTick, setLoadTick] = useState(0);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const loadKeys = useCallback(async () => {
    if (!(await ensureCustomerSession()).authenticated) throw new Error("SESSION_EXPIRED");
    const response = await fetchWithTimeout("/api/odoo/keys", { cache: "no-store", credentials: "include" });
    if (!response.ok) throw new Error("KEYS_UNAVAILABLE");
    const items: unknown = await response.json();
    if (!Array.isArray(items)) throw new Error("INVALID_KEYS_PAYLOAD");
    return items as ApiKey[];
  }, []);

  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    const bootstrap = async () => {
      setLoading(true);
      setError(null);
      try {
        // Confirm or refresh the customer cookie BEFORE starting the four
        // protected requests. All four projections settle before first paint.
        if (!(await ensureCustomerSession()).authenticated) throw new Error("SESSION_EXPIRED");
        const epoch = refreshEpoch.current;
        const [keysResponse, installsResponse, principalResponse, billingResponse] = await Promise.all([
          fetchWithTimeout("/api/odoo/keys", { credentials: "include", cache: "no-store" }),
          fetchWithTimeout("/api/odoo/installations", { credentials: "include", cache: "no-store" }),
          fetchWithTimeout("/api/auth/me", { credentials: "include", cache: "no-store" }),
          fetchWithTimeout("/api/billing/status", { credentials: "include", cache: "no-store" }),
        ]);
        if (!keysResponse.ok || !installsResponse.ok || !principalResponse.ok || !billingResponse.ok)
          throw new Error("CONNECTION_DATA_UNAVAILABLE");
        const [nextKeys, nextInstalls, principal, billing] = await Promise.all([
          keysResponse.json() as Promise<ApiKey[]>,
          installsResponse.json() as Promise<Installation[]>,
          principalResponse.json() as Promise<{ permissions?: string[] }>,
          billingResponse.json() as Promise<{ hasSubscription?: boolean }>,
        ]);
        if (!Array.isArray(nextKeys) || !Array.isArray(nextInstalls))
          throw new Error("INVALID_CONNECTION_DATA");
        if (cancelled) return;
        if (epoch === refreshEpoch.current) setKeys(nextKeys);
        setInstallations(nextInstalls);
        setCanManage(principal.permissions?.includes("integrations.manage") === true);
        setHasSubscription(billing.hasSubscription === true);
        setGatewayUrl(window.location.origin);
        setInitialLoaded(true);
        // Background refresh never replaces the page with a new skeleton or
        // resets an in-progress key mutation. A new mount has one bootstrap.
        poll = setInterval(() => {
          if (cancelled || mutationInFlight.current || document.visibilityState !== "visible") return;
          const observedEpoch = refreshEpoch.current;
          void loadKeys().then((items) => {
            if (!cancelled && observedEpoch === refreshEpoch.current) setKeys(items);
          }).catch(() => {
            if (!cancelled) setError(t("apiKeys.loadFailed"));
          });
        }, 30_000);
      } catch {
        if (!cancelled) setError(t("apiKeys.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
    };
  }, [loadKeys, loadTick, t]);

  async function generate() {
    if (mutationInFlight.current || !canManage) return;
    mutationInFlight.current = true;
    ++refreshEpoch.current;
    setBusy(true); setError(null); setRawKey(null); setRawKeyId(null); setCopied(false);
    try {
      if (!(await ensureCustomerSession()).authenticated) throw new Error(t("errors.sessionExpired"));
      const r = await fetchWithTimeout("/api/odoo/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim() || t("apiKeys.defaultName"),
        }),
      });
      const b = await r.json();
      if (!r.ok) { setError(t(codeMessageKey(b.code) ?? "apiKeys.operationFailed")); return; }
      setRawKey(b.apiKey);
      setRawKeyId(b.id);
      setKeys(await loadKeys());
    } catch { setError(t("apiKeys.operationFailed")); } finally { mutationInFlight.current = false; setBusy(false); }
  }

  async function confirm() {
    if (!pending || mutationInFlight.current || !canManage) return;
    mutationInFlight.current = true;
    ++refreshEpoch.current;
    const cur = pending; setBusy(true); setError(null);
    try {
      if (!(await ensureCustomerSession()).authenticated) throw new Error(t("errors.sessionExpired"));
      const r = cur.kind === "rotate"
        ? await fetchWithTimeout(`/api/odoo/keys/${encodeURIComponent(cur.id)}/rotate`, { method: "POST", credentials: "include" })
        : await fetchWithTimeout("/api/odoo/keys", { method: "DELETE", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(cur.kind === "revoke" ? { id: cur.id } : { id: cur.id, remove: true }) });
      const b = await r.json();
      if (!r.ok) { setError(t(codeMessageKey(b.code) ?? "apiKeys.operationFailed")); return; }
      setPending(null);
      if (cur.kind === "rotate") {
        setRawKey(b.apiKey); setRawKeyId(b.id); setCopied(false);
        try { setKeys(await loadKeys()); } catch { setError(t("apiKeys.loadFailed")); }
        return;
      }
      if (rawKeyId === cur.id) { setRawKey(null); setRawKeyId(null); setCopied(false); }
      setKeys(current => cur.kind === "remove" ? current.filter(key => key.id !== cur.id) : current.map(key => key.id === cur.id ? { ...key, revokedAt: b.revokedAt, rotationState: "revoked", odooEnabled: false } : key));
      try { setKeys(await loadKeys()); } catch { setError(t("apiKeys.loadFailed")); }
    } catch { setError(t("apiKeys.operationFailed")); } finally { mutationInFlight.current = false; setBusy(false); }
  }

  const active = keys.filter(k => !k.revokedAt).length;
  const enabled = keys.filter(k => !k.revokedAt && k.odooEnabled).length;


  // One stable initial state: do not render the empty connection form, access
  // badges or onboarding copy before the owner and key inventory are known.
  if (loading || !initialLoaded) {
    return (
      <>
        <PageHeader icon={<KeyRound className="h-4 w-4" />} title={t("v4.connection.title")} />
        <PageContainer>
          {error && !loading
            ? <ErrorState title={t("apiKeys.loadFailed")} message={error} retry={() => setLoadTick(tick => tick + 1)} />
            : <div role="status" aria-label={t("apiKeys.loadingCredentials")} className="space-y-5" aria-busy="true">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-44 w-full" />
                <Skeleton className="h-48 w-full" />
                <span className="sr-only">{t("apiKeys.loadingCredentials")}</span>
              </div>}
        </PageContainer>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={t("nav.section.integration")}
        icon={<KeyRound className="h-4 w-4" />}
        title={t("v4.connection.title")}
        description={active === 0 ? t("v4.connection.intro") : undefined}
        meta={
          active > 0 ? (
            <StatusBadge tone={enabled > 0 ? "ok" : "warn"} label={tc("apiKeys.activeCount", active, { count: formatNumber(active) })} />
          ) : (
            <StatusBadge tone="neutral" label={t("apiKeys.notConnected")} />
          )
        }
      />

      <PageContainer>
        <div className="space-y-5">
          {error && (
            <ErrorState
              title={t("apiKeys.operationFailed")}
              message={error}
              retry={() => {
                setError(null);
                void loadKeys().then(setKeys).catch(() => setError(t("apiKeys.loadFailed")));
              }}
            />
          )}

          {hasSubscription === false && (
            <Callout
              tone="warn"
              title={t("apiKeys.choosePlanBeforeConnect")}
              action={
                <Button variant="primary" size="sm" href="/onboarding">
                  {t("apiKeys.choosePlanCta")}
                </Button>
              }
            >
              {t("apiKeys.choosePlanBody")}
            </Callout>
          )}

          {rawKey && (
            <Callout
              tone="brand"
              title={t("apiKeys.newKeyTitle")}
              icon={<KeyRound className="h-4 w-4" aria-hidden />}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => { if (await copyTextToClipboard(rawKey)) setCopied(true); else setError(t("v4.connection.copyFailed")); }}
                  icon={<Copy className="h-3.5 w-3.5" />}
                >
                  {copied ? t("success.copied") : t("apiKeys.copyKey")}
                </Button>
              }
            >
              <div className="space-y-2">
                <p>{t("apiKeys.shownOnceBody")}</p>
                <code dir="ltr" className="block select-all break-all rounded-md border border-edge bg-surface px-3 py-2 font-mono text-xs text-ink">
                  {rawKey}
                </code>
                <Button variant="ghost" onClick={() => { setRawKey(null); setRawKeyId(null); setCopied(false); }}>{t("v4.connection.hideSecret")}</Button>
              </div>
            </Callout>
          )}

          <Card>
            <CardHeader title={t("v4.connection.status")} icon={<StatusDot tone={loading ? "neutral" : enabled > 0 ? "ok" : "warn"} />} />
            <div className="space-y-4 p-5">
              <h2 className="text-lg font-semibold">{t(loading ? "common.loading" : enabled > 0 ? "v4.connection.enabled" : active > 0 ? "v4.connection.waiting" : "v4.connection.start")}</h2>
              {enabled === 0 && <p className="text-sm text-ink-3">{t(active > 0 ? "v4.connection.waitingBody" : "v4.connection.startBody")}</p>}
              {installations.length > 0 && <ul className="space-y-2">{installations.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-edge p-3"><span className="font-semibold">{item.name}</span><StatusBadge tone={item.enabled && item.api_key_ids.some(id => keys.some(key => key.id === id && !key.revokedAt && key.odooEnabled)) ? "ok" : "warn"} label={t(item.enabled ? "v4.connection.enrolled" : "v4.connection.disabled")} /></li>)}</ul>}
              {enabled > 0 && <Button href="/dashboard#printers" variant="primary">{t("v4.connection.selectPrinters")}</Button>}
              {!canManage && !loading && <p className="text-sm text-ink-3">{t("v4.connection.readOnly")}</p>}
            </div>
          </Card>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.85fr)]">
            <div className="space-y-5">
              <Card>
                <CardHeader
                  title={t("apiKeys.connectOdoo")}
                  subtitle={t("apiKeys.connectDescription")}
                  icon={<KeyRound className="h-4 w-4" />}
                />
                <form
                  onSubmit={(e) => { e.preventDefault(); void generate(); }}
                  className="space-y-4 px-5 py-5"
                >
                  <Field
                    label={t("apiKeys.credentialName")}
                    htmlFor="key-name"
                    hint={t("apiKeys.credentialNameHint")}
                  >
                    <Input
                      id="key-name"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder={t("apiKeys.defaultName")}
                      disabled={busy || !canManage}
                    />
                  </Field>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="max-w-[52ch] text-sm leading-relaxed text-ink-3">
                      {t("apiKeys.scopeNote")}
                    </p>
                    <Button
                      type="submit"
                      variant="primary"
                      loading={busy}
                      disabled={busy || !canManage || hasSubscription !== true}
                      icon={busy ? undefined : <Plus className="h-4 w-4" />}
                      title={hasSubscription === false ? t("apiKeys.choosePlanFirstCta") : undefined}
                    >
                      {busy ? t("apiKeys.generating") : t("apiKeys.generateKey")}
                    </Button>
                  </div>
                </form>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader
                  title={t("apiKeys.credentials")}
                  subtitle={tc("apiKeys.issuedCount", keys.length, { count: formatNumber(keys.length) })}
                  icon={<ShieldCheck className="h-4 w-4" />}
                />

                {loading ? (
                  <div className="space-y-3 px-5 py-5" role="status" aria-label={t("apiKeys.loadingCredentials")}>
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="flex items-center justify-between gap-4">
                        <div className="space-y-2">
                          <Skeleton className="h-3.5 w-40" />
                          <Skeleton className="h-2.5 w-56" />
                        </div>
                        <Skeleton className="h-8 w-20" />
                      </div>
                    ))}
                    <span className="sr-only">{t("apiKeys.loadingCredentials")}</span>
                  </div>
                ) : keys.length === 0 ? (
                  <EmptyState
                    icon={<KeyRound className="h-5 w-5" />}
                    title={t("apiKeys.noCredentials")}
                    description={t("apiKeys.emptyDescription")}
                  />
                ) : (
                  <ul className="divide-y divide-edge-subtle">
                    {keys.map(k => {
                      const rotation = rotationMeta(k, t);
                      return (
                        <li
                          key={k.id}
                          className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 transition-colors duration-150 hover:bg-surface-hover"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-[600] text-ink">{k.name}</span>
                              <StatusBadge tone={rotation.tone} label={rotation.label} size="sm" />
                              {!k.revokedAt && (
                                <StatusBadge
                                  tone={k.odooEnabled ? "ok" : "warn"}
                                  label={k.odooEnabled ? t("apiKeys.odooEnabled") : t("apiKeys.odooDisabled")}
                                  size="sm"
                                />
                              )}
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                              <span>{t("apiKeys.createdOn", { date: formatDate(k.createdAt) })}</span>
                              <span aria-hidden>·</span>
                              <span>
                                {k.lastUsedAt ? t("apiKeys.lastUsedOn", { date: formatDate(k.lastUsedAt) }) : t("apiKeys.neverUsed")}
                              </span>
                              {k.odooEnabledUpdatedAt && (
                                <>
                                  <span aria-hidden>·</span>
                                  <span>{t("apiKeys.syncedOn", { date: formatDateTime(k.odooEnabledUpdatedAt) })}</span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <Button variant="ghost" size="sm" aria-label={t("apiKeys.copyKeyId")} title={t("apiKeys.copyKeyId")} onClick={() => void copyTextToClipboard(k.id)} icon={<Copy className="h-3.5 w-3.5" />}>
                              <span className="sr-only">{t("apiKeys.copyKeyId")}</span>
                            </Button>
                            {!k.revokedAt && <Button variant="secondary" size="sm" disabled={busy || !canManage} icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => setPending({ kind: "rotate", id: k.id, name: k.name })}>{t("v4.connection.rotate")}</Button>}
                            {!k.revokedAt && <Button variant="secondary" size="sm" disabled={busy || !canManage} icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setPending({ kind: "revoke", id: k.id, name: k.name })}>
                              {t("apiKeys.revokeKey")}
                            </Button>}
                            <Button variant="danger" size="sm" disabled={busy || !canManage} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setPending({ kind: "remove", id: k.id, name: k.name })}>
                              {t("apiKeys.removeKey")}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </div>

            <aside className="space-y-5">
              {enabled === 0 && <Callout tone="info" title={t("v4.connection.gatewayUrl")}><code dir="ltr" className="block break-all">{gatewayUrl || "—"}</code><p className="mt-2">{t("v4.connection.notPairing")}</p></Callout>}
              {enabled === 0 && <details className="card group overflow-hidden">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/35">
                  <span className="min-w-0">
                    <span className="block text-md font-[600] leading-snug text-ink">{t("apiKeys.howItWorks")}</span>
                    <span className="mt-0.5 block text-sm text-ink-3">{t("apiKeys.howItWorksSubtitle")}</span>
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <ol className="space-y-4 border-t border-edge-subtle px-5 py-5">
                  {[
                    [t("v4.connection.step1"), t("v4.connection.step1Body")],
                    [t("v4.connection.step2"), t("v4.connection.step2Body")],
                    [t("v4.connection.step3"), t("v4.connection.step3Body")],
                    [t("v4.connection.step4"), t("v4.connection.step4Body")],
                  ].map(([title, body], index) => (
                    <li key={title} className="flex gap-3">
                      <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-edge bg-surface-2 text-2xs font-[650] tabular text-ink-3">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-[600] text-ink">{title}</div>
                        <p className="mt-0.5 text-sm leading-relaxed text-ink-3">{body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </details>}


              <div className="text-sm text-ink-3">
                {t("apiKeys.needModule")}{" "}
                <Link href="/settings" className="font-[550] text-brand hover:underline">
                  {t("apiKeys.reviewWorkspaceSettings")}
                </Link>
                .
              </div>
            </aside>
          </div>
        </div>
      </PageContainer>

      <Modal
        open={!!pending}
        onClose={() => { if (!busy) setPending(null); }}
        title={pending?.kind === "rotate" ? t("v4.connection.rotateTitle") : pending?.kind === "revoke" ? t("apiKeys.revokeCredentialTitle") : t("apiKeys.removeCredentialTitle")}
        description={pending?.name}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={busy || !canManage}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => void confirm()}
              loading={busy}
              disabled={busy || !canManage}
            >
              {pending?.kind === "rotate" ? t("v4.connection.rotate") : pending?.kind === "revoke" ? t("apiKeys.revokeConfirm") : t("apiKeys.removeConfirm")}
            </Button>
          </>
        }
      >
        {error && <ErrorState title={t("errors.operationFailed")} message={error} />}
        {pending?.kind === "rotate" ? <Callout tone="warn" title={t("v4.connection.rotateTitle")}>{t("v4.connection.rotateBody")}</Callout> : pending?.kind === "revoke" ? (
          <Callout tone="warn" title={t("apiKeys.odooLosesAccess")}>
            {t("apiKeys.revokeBody")}
          </Callout>
        ) : (
          <Callout tone="bad" title={t("common.cannotUndo")}>
            {t("apiKeys.removeRecordBody")}
          </Callout>
        )}
      </Modal>
    </>
  );
}
