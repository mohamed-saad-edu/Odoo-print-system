import React from "react";
import { Activity, KeyRound, Link2, Play, Power, RotateCcw, Server, ShieldCheck, Square, Copy } from "lucide-react";
import { Button, Card, ErrorState, Field, Input, StatusBadge, StatusDot } from "../../components/ui";
import { SettingsSection } from "../ui";
import type { DesktopState } from "../types";
import { useI18n } from "../../i18n/react";
import { agentServiceState, friendlyAgentError, printerDisplayName, printerDisplayStatus } from "../lib/printers";
import { copyTextToClipboard } from "../../lib/clipboard";
import { getAutostart, setAutostart } from "../lib/ipc";

export function SettingsPage({ s }: { s: DesktopState }) {
  const { t, locale } = useI18n();
  const anyStatus = s.agentStatus as Record<string, unknown> | null;
  const serviceState = agentServiceState(s.agentStatus);
  const [autostartBusy, setAutostartBusy] = React.useState(false);
  const gatewayDisplayError = s.gatewayDraftError ?? (s.gatewayDraftMatchesSaved ? s.healthError : null);
  const hasGatewayDraft = s.gatewayDraftUrl.trim().length > 0;
  const gatewayDraftPending = hasGatewayDraft && !s.gatewayDraftMatchesSaved;
  const paths: [string, string][] = s.runtimePaths
    ? [
        [t("desktop.settings.managerData"), s.runtimePaths.manager_data],
        [t("desktop.settings.settingsFile"), s.runtimePaths.settings],
        [t("desktop.settings.agentConfig"), s.runtimePaths.agent_config],
        [t("desktop.settings.managerLog"), s.runtimePaths.manager_log],
        [t("desktop.settings.agentData"), s.runtimePaths.agent_data],
      ]
    : [];

  return (
    <div className="space-y-5">
      <div className="grid gap-5">
        <details open={!s.pairingConfirmed} className="rounded-xl border border-edge bg-surface p-4">
        <summary className="cursor-pointer text-base font-semibold text-ink">{t("v4.experience.setup.gateway")}</summary>
        <div className="mt-4">
        <SettingsSection title={t("desktop.settings.gatewaySection")} description={t("desktop.settings.gatewaySectionBody")} icon={<Link2 className="h-4 w-4" />}>
          <div className="flex items-center gap-3 rounded-md border border-edge bg-surface-2/45 p-4">
            <StatusDot tone={gatewayDraftPending ? "neutral" : s.gatewayConnected ? "ok" : s.gatewayUrl ? "bad" : "neutral"} pulse={!gatewayDraftPending && s.gatewayConnected} />
            <div className="min-w-0 flex-1">
              <div className="break-words text-base font-semibold text-ink">{gatewayDraftPending ? t("desktop.settings.draftNotVerified") : s.gatewayConnected ? t("desktop.settings.connected") : s.gatewayUrl ? t("desktop.settings.unreachable") : t("desktop.settings.notConfigured")}</div>
              <div dir="auto" className="mt-1 break-words text-xs text-ink-3 [overflow-wrap:anywhere] [unicode-bidi:isolate]">{s.gatewayDraftUrl || t("desktop.settings.enterGatewayUrl")}</div>
            </div>
          </div>
          <Field label={t("desktop.settings.gatewayUrlLabel")} htmlFor="gw-url" hint={t("desktop.settings.gatewayUrlHint")}>
            <Input id="gw-url" dir="ltr" value={s.gatewayDraftUrl} onChange={(e) => s.setGatewayDraftUrl(e.target.value)} placeholder="https://gateway.example.com" className="font-mono text-sm" />
          </Field>
          <div className="space-y-1 rounded-md border border-edge-subtle bg-surface-2 px-3 py-2.5 text-xs text-ink-3">
            <div dir="auto" className="break-words [overflow-wrap:anywhere] [unicode-bidi:isolate]">{t("desktop.settings.savedGateway", { url: s.gatewayUrl || t("desktop.settings.notConfigured") })}</div>
            <div dir="auto" className="break-words [overflow-wrap:anywhere] [unicode-bidi:isolate]">{t("desktop.settings.lastObservedGateway", { url: s.checkedGatewayUrl || t("desktop.settings.notObservedYet") })}</div>
          </div>
          {gatewayDraftPending && <p className="text-xs text-warn">{t("desktop.settings.draftNotSavedBody")}</p>}
          <div className="flex min-w-0 justify-end"><Button variant="primary" onClick={s.checkHealth} loading={s.gatewayChecking} icon={<Activity className="h-4 w-4" />} className="max-w-full min-w-0 h-auto min-h-10" ><span className="min-w-0 whitespace-normal break-words text-center leading-snug">{t("desktop.settings.checkConnection")}</span></Button></div>
          {gatewayDisplayError && <ErrorState title={t("desktop.settings.checkFailed")} message={gatewayDisplayError} retry={s.checkHealth} />}
        </SettingsSection>

        </div></details>
        <details className="rounded-xl border border-edge bg-surface p-4">
        <summary className="cursor-pointer text-base font-semibold text-ink">{t("v4.experience.settings.device")}</summary>
        <div className="mt-4">
        <SettingsSection title={t("desktop.settings.localAgentSection")} description={t("desktop.settings.localAgentSectionBody")} icon={<Server className="h-4 w-4" />}>
          <div className="flex items-center gap-3 rounded-md border border-edge bg-surface-2/45 p-4">
            <StatusDot tone={serviceState === "unknown" ? "neutral" : s.isOnline ? "ok" : "bad"} pulse={s.isOnline} />
            <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-ink">{serviceState === "unknown" ? t("desktop.agents.statusUnavailable") : s.isOnline ? t("desktop.settings.agentOnline") : t("desktop.settings.agentStopped")}</div><div dir="auto" className="mt-0.5 truncate text-xs text-ink-3 [unicode-bidi:isolate]">{String(anyStatus?.hostname || t("desktop.settings.thisPc"))}</div></div>
          </div>
          <div><div className="mb-2 text-xs font-semibold text-ink">{t("desktop.settings.serviceControl")}</div><div className="flex flex-wrap gap-2"><Button variant="primary" onClick={s.startAgent} disabled={s.busy} icon={<Play className="h-4 w-4" />} >{t("desktop.agents.start")}</Button><Button variant="secondary" onClick={s.requestStopAgent} disabled={s.busy} icon={<Square className="h-4 w-4" />} >{t("desktop.agents.stop")}</Button><Button variant="ghost" onClick={s.restartAgent} disabled={s.busy} icon={<RotateCcw className="h-4 w-4" />} >{t("desktop.agents.restart")}</Button></div></div>
          <div className="border-t border-edge pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-2.5"><Power className="mt-0.5 h-4 w-4 text-ink-3" /><div><div className="text-sm font-semibold text-ink" id="autostart-label">{t("desktop.settings.startWithWindows")}</div><p className="mt-1 text-sm leading-snug text-ink-3">{t("desktop.settings.startWithWindowsBody")}</p></div></div>
              <button role="switch" aria-checked={!!s.autostart} aria-labelledby="autostart-label" aria-busy={s.autostart === null || autostartBusy} disabled={s.autostart === null || autostartBusy} onClick={async () => {
                if (s.autostart === null || autostartBusy) return; const next = !s.autostart; setAutostartBusy(true);
                try { await setAutostart(next); const st = await getAutostart(); s.setAutostartState(st.enabled); s.setMsg({ text: st.enabled ? t("desktop.settings.autostartOn") : t("desktop.settings.autostartOff"), type: "success" }); }
                catch (error) { s.setMsg({ text: friendlyAgentError(error instanceof Error ? error.message : t("desktop.settings.autostartFailed"), locale), type: "error" }); }
                finally { setAutostartBusy(false); }
              }} dir="ltr" className={`relative inline-flex h-8 w-14 flex-shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 focus-visible:ring-offset-2 focus-visible:ring-offset-app ${s.autostart ? "border-brand bg-brand" : "border-edge-strong bg-surface-3"}`}>
                <span className={`absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${s.autostart ? "translate-x-6" : "translate-x-0"}`} />
              </button>
            </div>
            {s.autostart === null && (
              <div className="mt-2 flex items-center gap-2 text-xs text-ink-3">
                <span>{t("desktop.settings.autostartUnknown")}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={autostartBusy}
                  onClick={async () => {
                    setAutostartBusy(true);
                    try {
                      const st = await getAutostart();
                      s.setAutostartState(st.enabled);
                    } catch (error) {
                      s.setMsg({ text: friendlyAgentError(error instanceof Error ? error.message : t("desktop.settings.autostartFailed"), locale), type: "error" });
                    } finally {
                      setAutostartBusy(false);
                    }
                  }}
                >
                  {t("common.retry")}
                </Button>
              </div>
            )}
          </div>
        </SettingsSection>
        </div></details>
      </div>

      <Card className="overflow-hidden">
        <details open={!s.pairingConfirmed}><summary className="cursor-pointer px-5 py-4 text-base font-semibold text-ink">{t("v4.experience.settings.pairAgain")}</summary>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-edge-subtle px-5 py-4">
          <div className="flex items-start gap-2.5"><KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" /><div className="min-w-0"><h2 className="text-base font-semibold text-ink">{t("desktop.settings.pairTitle")}</h2><p className="mt-1 text-sm leading-snug text-ink-3">{t("desktop.settings.pairSubtitle")}</p></div></div>
          <StatusBadge label={serviceState === "unknown" ? t("desktop.agents.statusUnavailable") : s.isOnline ? (s.gatewayConnected ? t("desktop.settings.pairRunning") : t("desktop.settings.pairGatewayUnreachable")) : t("desktop.settings.pairStopped")} tone={s.isOnline ? (s.gatewayConnected ? "ok" : "warn") : "neutral"} />
        </div>
        <div className="grid gap-5 px-5 py-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <p className="text-sm text-ink-3">{t("desktop.settings.pairStep1")}</p>
          <div className="flex w-full max-w-sm flex-col gap-3">
            <Field label={t("desktop.settings.pairCodeLabel")} htmlFor="pair-code" className="flex-1">
              <div className="flex items-center gap-2"><Input id="pair-code" dir="ltr" value={s.pairCode} onChange={(e) => s.setPairCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="KQ7XTM" maxLength={6} className="text-center font-mono text-lg font-bold uppercase tracking-[0.3em] h-11 rounded-md" autoComplete="off" /><Button variant="primary" onClick={s.pair} loading={s.busy} disabled={!s.pairCode.trim() || s.pairCode.trim().length !== 6} icon={<ShieldCheck className="h-4 w-4" />} className="h-11 rounded-md">{t("desktop.settings.pair")}</Button></div>
            </Field>
          </div>
        </div>
        </details>
      </Card>

      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={async (event) => {
            const trigger = event.currentTarget;
            const report = [`=== Yaseir Agent Diagnostic Export ===`, `Generated: ${new Date().toISOString()}`, `Version: ${s.version || "unknown"}`, `Running: ${serviceState === "unknown" ? "unknown" : s.isOnline}`, `Gateway (saved): ${s.gatewayUrl || t("desktop.settings.notConfigured")}`, `Gateway (draft): ${s.gatewayDraftUrl || t("desktop.settings.notConfigured")}`, `Gateway (last observed): ${s.checkedGatewayUrl || "unknown"}`, `Reachable: ${s.gatewayConnected}`, `Printers: ${s.printers.length}`, `Pending: ${s.pendingJobs}, Failed: ${s.failedJobs}`, ``, `=== Printers ===`, ...s.printers.map((p) => ` - ${p.name} [${printerDisplayStatus(p, s.nowMs)}]`), ``, `=== Paths ===`, ...paths.map(([k, v]) => ` - ${k}: ${v}`)].join("\n");
            const copied = await copyTextToClipboard(report);
            s.setMsg({ text: t(copied ? "desktop.settings.statusCopied" : "desktop.settings.copyFailed"), type: copied ? "success" : "error" });
            if (trigger.isConnected) trigger.focus();
          }} icon={<Copy className="h-3.5 w-3.5" />}>{t("desktop.settings.copySummary")}</Button>
      </div>

    </div>
  );
}
