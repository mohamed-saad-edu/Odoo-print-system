"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { apiMessageKey } from "../../lib/api-error-keys";
import { fetchWithTimeout } from "../../lib/fetch-timeout";
import { SessionInventory } from "../../components/SessionInventory";
import { WorkspaceSecurity } from "../../components/WorkspaceSecurity";
import { roleLabel } from "../../lib/roles";
import { useI18n } from "../../i18n/react";
import {
  Building2,
  Crown,
  User,
  Shield,
  Save,
  Settings as SettingsIcon,
  CheckCircle2,
} from "lucide-react";
import {
  Button,
  Callout,
  Card,
  CardHeader,
  ErrorState,
  Field,
  Input,
  KeyValueList,
  PageContainer,
  PageHeader,
  Skeleton,
} from "../../components/ui";

type SettingsPayload = {
  tenant?: { id?: string; name?: string; createdAt?: string };
  email?: string;
  role?: string;
  platformOwner?: boolean;
};

function securityDestinationSnapshot() {
  return new URLSearchParams(window.location.search).get("reauth") === "1" || window.location.hash === "#workspace-security";
}
function subscribeSecurityDestination(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => { window.removeEventListener("hashchange", onChange); window.removeEventListener("popstate", onChange); };
}

export default function SettingsPage() {
  const securityRequested = useSyncExternalStore(subscribeSecurityDestination, securityDestinationSnapshot, () => false);
  const nameEdited = useRef(false);
  const [name, setName] = useState("");
  const { t, formatDate } = useI18n();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [tenantCreatedAt, setTenantCreatedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "ok" | "err" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Generation guard: a locale-triggered reload must not let an older
    // response overwrite a newer snapshot — or the operator's dirty draft
    // (C063). The fetched name seeds the field only when it is still pristine.
    let cancelled = false;
    fetchWithTimeout("/api/settings", { credentials: "include", cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(t("settings.loadFailed"));
        const d = (await r.json()) as SettingsPayload;
        if (cancelled) return;
        if (!nameEdited.current) setName(d.tenant?.name ?? "");
        setEmail(d.email ?? "");
        setRole(d.role ?? "");
        setTenantCreatedAt(d.tenant?.createdAt ?? null);
      })
      .catch(() => { if (!cancelled) setMessage({ text: t("settings.loadFailed"), type: "err" }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetchWithTimeout("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      const d = await r.json();
      if (!r.ok) { setMessage({ text: t(apiMessageKey(d.code, r.status, "settings.saveFailed")), type: "err" }); return; }
      setMessage({ text: t("settings.nameUpdated"), type: "ok" });
    } catch {
      setMessage({ text: t("settings.saveFailed"), type: "err" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader 
        icon={<SettingsIcon className="h-4 w-4" />}
        title={t("nav.settings")}
        width="narrow"
        
      />

      <PageContainer width="narrow">
        <div className="space-y-5">
          <nav aria-label={t("nav.section.workspace")} className="flex flex-wrap gap-3">
            {role === "owner" && <Button href="/billing" variant="secondary">{t("v4.experience.subscription")}</Button>}
            <Button href="/team" variant="secondary">{t("v4.experience.team")}</Button>
            <Button href="/api-keys" variant="secondary">{t("v4.experience.connection")}</Button>
          </nav>
          <details open={securityRequested} className="rounded-xl border border-edge bg-surface p-5">
            <summary className="cursor-pointer text-base font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35">{t("v4.experience.settings.security")}</summary>
            <div className="mt-5 space-y-5"><WorkspaceSecurity /><SessionInventory /></div>
          </details>
        {loading ? (
          <div className="space-y-5" role="status" aria-label={t("settings.loadingAria")}>
            <Skeleton className="h-[240px] rounded-lg" />
            <Skeleton className="h-[160px] rounded-lg" />
            <span className="sr-only">{t("settings.loadingShort")}</span>
          </div>
        ) : (
          <div className="space-y-5">
            <Card>
              <CardHeader
                title={t("settings.identityTitle")}
                subtitle={t("settings.identitySubtitle")}
                icon={<Building2 className="h-4 w-4" />}
              />
              <form onSubmit={save} className="space-y-5 px-5 py-5">
                <Field
                  label={t("onboarding.workspaceName")}
                  htmlFor="workspace-name"
                  hint={t("settings.workspaceNameHint")}
                  required
                >
                  <Input
                    id="workspace-name"
                    value={name}
                    onChange={(e) => { nameEdited.current = true; setName(e.target.value); }}
                    minLength={2}
                    maxLength={120}
                    required
                    placeholder={t("settings.namePlaceholder")}
                  />
                </Field>

                {message && (
                  <Callout
                    tone={message.type === "ok" ? "ok" : "bad"}
                    icon={message.type === "ok" ? <CheckCircle2 className="h-4 w-4" /> : undefined}
                    title={message.type === "ok" ? t("settings.saved") : t("settings.saveFailed")}
                  >
                    {message.text}
                  </Callout>
                )}

                <div className="flex items-center justify-end gap-2 border-t border-edge-subtle pt-4">
                  <Button type="submit" variant="primary" disabled={busy || name.trim().length < 2} loading={busy} icon={<Save className="h-4 w-4" />}>
                    {busy ? t("common.saving") : t("common.saveChanges")}
                  </Button>
                </div>
              </form>
            </Card>

            <Card>
              <CardHeader
                title={t("settings.yourAccess")}
                subtitle={t("settings.yourAccessSubtitle")}
                icon={<User className="h-4 w-4" />}
              />
              <div className="px-5 py-4">
                <KeyValueList
                  rows={[
                    { label: t("settings.signedInAs"), value: email || "—" },
                    { label: t("settings.role"), value: role === "owner"
                        ? <span className="inline-flex items-center gap-1.5 font-semibold"><Crown className="h-4 w-4 text-warn" aria-hidden />{t("team.role.owner")}</span>
                        : <span>{roleLabel(role, t)}</span> },
                    {
                      label: t("settings.workspaceCreated"),
                      value: tenantCreatedAt ? formatDate(tenantCreatedAt) : "—",
                    },
                  ]}
                />
                <div className="mt-3 flex items-start gap-2.5 rounded-md border border-edge-subtle bg-surface-2 px-3.5 py-3">
                  <Shield className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                  <p className="text-sm leading-relaxed text-ink-3">
                    {t("settings.roleChangesImmediate")}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        )}
        </div>
      </PageContainer>
    </>
  );
}
