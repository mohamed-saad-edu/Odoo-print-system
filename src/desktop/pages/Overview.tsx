import React from "react";
import { SetupGuide } from "../components/SetupGuide";
import { Activity, AlertTriangle, CheckCircle2, ClipboardList, FileText, Loader2, Play, Printer as PrinterIcon, RefreshCw, Server, Settings } from "lucide-react";
import { Button, Card, CardHeader, EmptyState, ErrorState, LoadingState, StatusBadge } from "../../components/ui";
import { StatItem, StatStrip, StatusNotice, ViewAllButton, PrinterAvatar } from "../ui";
import { PrinterSharingControl } from "../components/PrinterSharingControl";
import type { DesktopState } from "../types";
import { useI18n } from "../../i18n/react";
import { agentServiceState, agentStatusNoteKey, deriveOutcome, isProductionPrinter, isMainInventoryPrinter, jobDocType, jobId, jobPrinterId, jobStatus, jobTimestamp, labelJob, toneJob, printerDisplayName, printerPresentation, printerHealthCounts } from "../lib/printers";

export function OverviewPage({ s }: { s: DesktopState }) {
  const { t, tc, locale, formatDateTime } = useI18n();
  const serviceState = agentServiceState(s.agentStatus);
  const shownPrinters = s.printers.filter(isMainInventoryPrinter);
  const gatewayPrinterIds = new Set(s.printers.map((p) => p.id));
  const pendingLocalPrinters = s.discoveredPrinters.filter(isProductionPrinter).filter((p) => !gatewayPrinterIds.has(p.id));
  const { online, offline, unknown: unknownPrinters } = printerHealthCounts(shownPrinters, s.nowMs);
  // Uncertain physical outcomes are attention-worthy on their own: a failed
  // job whose outcome markers say UNKNOWN may already exist on paper.
  const unknownJobs = s.jobs.filter(
    (j) => ["failed", "expired"].includes(jobStatus(j)) && deriveOutcome(jobStatus(j), typeof j.error === "string" ? j.error : null) === "unknown",
  ).length;

  const banner = (() => {
    if (!s.gatewayUrl) {
      return <StatusNotice tone="warn" icon={<AlertTriangle className="h-5 w-5" />} title={t("desktop.overview.gatewayNeedsConfig")} action={<Button variant="primary" onClick={() => s.navigate("settings")} icon={<Settings className="h-4 w-4" />}>{t("desktop.overview.configureGateway")}</Button>}>{t("desktop.overview.gatewayUrlMissing")}</StatusNotice>;
    }
    if (!s.gatewayConnected) {
      return <StatusNotice tone="warn" icon={<AlertTriangle className="h-5 w-5" />} title={t("desktop.overview.gatewayUnreachable")} action={<Button variant="primary" onClick={s.checkHealth} icon={<Activity className="h-4 w-4" />}>{t("desktop.overview.retryCheck")}</Button>}>{s.healthError ? t("desktop.overview.gatewayNoAnswer", { detail: s.healthError }) : t("desktop.overview.gatewayNoAnswerPlain")}</StatusNotice>;
    }
    if (serviceState === "unknown") {
      return <StatusNotice tone="info" icon={<Activity className="h-5 w-5" />} title={t("desktop.agents.statusUnavailable")} action={<Button variant="secondary" onClick={s.refreshStatus} icon={<RefreshCw className="h-4 w-4" />}>{t("desktop.overview.refresh")}</Button>}>{t(agentStatusNoteKey(s.agentStatus))}</StatusNotice>;
    }
    if (serviceState === "stopped") {
      return <StatusNotice tone="warn" icon={<AlertTriangle className="h-5 w-5" />} title={t("desktop.overview.agentOfflineTitle")} action={<Button variant="primary" onClick={s.startAgent} icon={<Play className="h-4 w-4" />}>{t("desktop.overview.startAgent")}</Button>}>{t("desktop.overview.agentNotRunning")}</StatusNotice>;
    }
    if (s.localPrintersError) {
      return <StatusNotice tone="warn" icon={<AlertTriangle className="h-5 w-5" />} title={t("desktop.printers.localInventoryFailed")} action={<Button variant="secondary" onClick={() => void s.refreshLocalPrinters()} icon={<RefreshCw className="h-4 w-4" />}>{t("desktop.overview.refresh")}</Button>}>{s.localPrintersError}</StatusNotice>;
    }
    if (s.printersError || s.jobsError) {
      const detail = s.printersError || s.jobsError || t("desktop.overview.gatewayNoAnswerPlain");
      return <StatusNotice tone="warn" icon={<AlertTriangle className="h-5 w-5" />} title={t("desktop.overview.needsAttention")} action={<Button variant="secondary" onClick={() => { void s.refreshPrinters(); void s.refreshJobs(); }} icon={<RefreshCw className="h-4 w-4" />}>{t("desktop.overview.refresh")}</Button>}>{detail}</StatusNotice>;
    }
    if (s.printersLoading || s.localPrintersLoading || s.jobsLoading) {
      return <StatusNotice tone="info" icon={<Loader2 className="h-5 w-5 animate-spin" aria-hidden />} title={t("common.checking")} />;
    }
    if (offline > 0 || unknownPrinters > 0 || s.failedJobs > 0 || unknownJobs > 0) {
      const parts: string[] = [];
      if (offline > 0) parts.push(tc("desktop.overview.printersNeedAttention", offline));
      if (unknownPrinters > 0) parts.push(t("desktop.overview.unreadable", { count: unknownPrinters }));
      if (s.failedJobs > 0) parts.push(tc("desktop.overview.jobsFailed", s.failedJobs));
      if (unknownJobs > 0) parts.push(tc("desktop.overview.jobsUnknown", unknownJobs));
      return <StatusNotice tone="warn" icon={<AlertTriangle className="h-5 w-5" />} title={t("desktop.overview.needsAttention")} action={<Button variant="secondary" onClick={() => s.navigate(offline > 0 || unknownPrinters > 0 ? "printers" : "jobs")}>{offline > 0 || unknownPrinters > 0 ? t("desktop.overview.reviewPrinters") : t("desktop.overview.reviewJobs")}</Button>}>{parts.join(" • ")}</StatusNotice>;
    }
    if (shownPrinters.length === 0) {
      return <StatusNotice tone="info" icon={<PrinterIcon className="h-5 w-5" />} title={pendingLocalPrinters.length > 0 ? t("desktop.printers.waitingTitle") : t("desktop.overview.noPhysicalPrinters")} action={<Button variant="primary" onClick={() => s.navigate("printers")}>{t("desktop.overview.reviewPrinters")}</Button>}>{pendingLocalPrinters.length > 0 ? t("desktop.printers.waitingBody") : t("desktop.overview.noPhysicalPrintersBody")}</StatusNotice>;
    }
    return <StatusNotice tone="ok" icon={<CheckCircle2 className="h-5 w-5" />} title={t("desktop.overview.allNormal")}>{t("desktop.overview.allNormalBody")}</StatusNotice>;
  })();

  return (
    <div className="yw-agent-overview space-y-6">
      <div className="yw-agent-status">{banner}</div>
      <SetupGuide s={s} />

      <div className="yw-agent-stats"><StatStrip>
        <StatItem label={t("desktop.overview.statAgent")} value={serviceState === "unknown" ? t("desktop.status.unknown") : s.isOnline ? t("desktop.status.online") : t("desktop.status.offline")} sub={t(agentStatusNoteKey(s.agentStatus))} tone={serviceState === "unknown" ? "neutral" : s.isOnline ? "ok" : "bad"} icon={<Activity className="h-4 w-4" />} />
        <StatItem label={t("desktop.overview.statGateway")} value={s.gatewayUrl ? (s.gatewayConnected ? t("desktop.status.connected") : t("desktop.status.unreachable")) : t("desktop.status.notConfigured")} sub={!s.gatewayUrl ? t("desktop.overview.setUrlInSettings") : s.gatewayConnected ? t("desktop.status.reachable") : t("desktop.status.failedLastCheck")} tone={s.gatewayConnected ? "ok" : s.gatewayUrl ? "bad" : "neutral"} icon={<Server className="h-4 w-4" />} />
        <StatItem label={t("desktop.overview.statPrinters")} value={`${online} / ${shownPrinters.length}`} sub={unknownPrinters > 0 ? t("printer.presentation.unavailableCount", { count: unknownPrinters }) : offline > 0 ? t("printer.presentation.attentionCount", { count: offline }) : t("printer.presentation.availableCount", { count: online })} tone={shownPrinters.length > 0 && offline + unknownPrinters === 0 ? "ok" : shownPrinters.length === 0 ? "neutral" : "warn"} icon={<PrinterIcon className="h-4 w-4" />} />
        <StatItem label={t("desktop.overview.statJobs")} value={s.jobsLoading || s.jobsError ? "—" : String(s.pendingJobs)} sub={s.jobsLoading ? t("common.checking") : s.jobsError ? t("desktop.overview.queueUnavailable") : s.failedJobs > 0 ? tc("desktop.overview.jobsFailed", s.failedJobs) : t("desktop.status.pending")} tone={s.jobsLoading || s.jobsError ? "neutral" : s.failedJobs > 0 ? "bad" : s.pendingJobs > 0 ? "info" : "neutral"} icon={<ClipboardList className="h-4 w-4" />} />
      </StatStrip></div>

      <div className="grid gap-6">
        <Card className="overflow-hidden">
          <CardHeader title={t("desktop.overview.printersTitle")} subtitle={t("desktop.overview.printersOnlineCount", { online, total: shownPrinters.length })} icon={<PrinterIcon className="h-4 w-4 text-brand" />} actions={<Button size="sm" variant="secondary" onClick={s.refreshPrinters} icon={<RefreshCw className="h-4 w-4" />}>{t("desktop.overview.refresh")}</Button>} />
          <div className="px-5 pb-5">
            {s.printersLoading && shownPrinters.length === 0 ? <LoadingState rows={3} /> : s.printersError && shownPrinters.length === 0 && pendingLocalPrinters.length === 0 ? <ErrorState title={t("desktop.overview.unableToLoadPrinters")} message={s.printersError} retry={s.refreshPrinters} /> : shownPrinters.length === 0 ? (
              <EmptyState
                icon={<PrinterIcon className="h-8 w-8" />}
                title={pendingLocalPrinters.length > 0 ? t("desktop.printers.waitingTitle") : t("desktop.overview.noPhysicalPrinters")}
                description={pendingLocalPrinters.length > 0 ? t("desktop.printers.waitingBody") : t("desktop.overview.noPhysicalPrintersBody")}
                action={<><Button variant="primary" onClick={s.handleDiscover} icon={<RefreshCw className="h-4 w-4" />}>{t("desktop.overview.discover")}</Button><Button variant="secondary" onClick={() => s.setShowAdd(true)} icon={<PrinterIcon className="h-4 w-4" />}>{t("desktop.overview.addPrinter")}</Button></>}
              />
            ) : (
              <div className="divide-y divide-edge-subtle">
                {shownPrinters.slice(0, 5).map((p) => {
                  const view = printerPresentation(p, undefined, s.nowMs);
                  const name = printerDisplayName(p, locale);
                  return (
                    <div key={p.id} className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3 px-1 py-3.5 transition-colors hover:bg-surface-hover sm:px-2">
                      <button type="button" onClick={() => { s.setJobPrinterFilter(p.id); s.setJobTab("all"); s.setJobSearch(""); s.navigate("jobs"); }} className="flex w-full min-w-0 items-center gap-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 focus-visible:ring-offset-1 focus-visible:ring-offset-app sm:w-auto sm:flex-1">
                        <PrinterAvatar name={name} size="lg" tone={view.tone} />
                        <span className="min-w-0 flex-1"><span className="block break-words text-base font-semibold text-ink">{name}</span>{p.agentName && <span className="mt-0.5 block break-words text-xs text-ink-3">{p.agentName}</span>}</span>
                      </button>
                      <div className="flex max-w-full flex-wrap items-center gap-2">
                        <StatusBadge tone={view.tone} label={t(view.labelKey)} />
                        <Button size="sm" variant="ghost" onClick={() => s.setSelectedPrinter(p)}>{t("desktop.printers.details")}</Button>
                        <Button size="sm" variant="secondary" onClick={() => s.handleTest(p.id)} disabled={s.busy || !s.gatewayTestPrinterIds.has(p.id)} icon={<Activity className="h-3 w-3 text-brand" />} title={t("desktop.overview.testNamed", { name })}>{t("desktop.overview.test")}</Button>
                      </div>
                      <div className="w-full min-w-0 space-y-2"><PrinterSharingControl s={s} printer={p} />{!s.gatewayTestPrinterIds.has(p.id) && <p className="text-xs text-ink-3">{t("desktop.printers.cloudTestUnavailable")}</p>}</div>
                    </div>
                  );
                })}
                <ViewAllButton label={t("desktop.overview.viewAllPrinters")} onClick={() => s.navigate("printers")} />
              </div>
            )}
          </div>
        </Card>


      </div>

      <Card className="overflow-hidden">
        <CardHeader title={t("desktop.overview.recentJobs")} subtitle={t("desktop.overview.recentJobsSubtitle", { pending: s.pendingJobs, failed: s.failedJobs })} icon={<ClipboardList className="h-4 w-4 text-brand" />} actions={<Button size="sm" variant="ghost" onClick={() => s.navigate("jobs")}>{t("desktop.overview.viewAll")}</Button>} />
        {s.jobsLoading ? <div className="px-5 pb-5"><LoadingState rows={3} /></div> : s.jobsError ? <div className="px-5 pb-5"><ErrorState title={t("desktop.overview.jobsUnavailable")} message={s.jobsError} retry={() => { void s.refreshJobs(); }} /></div> : s.jobs.length === 0 ? <EmptyState icon={<FileText className="h-8 w-8" />} title={t("desktop.overview.noJobsYet")} description={t("desktop.overview.noJobsYetBody")} /> : (
          <>
          <ul className="divide-y divide-edge-subtle lg:hidden">
            {s.jobs.slice(0, 5).map((j) => (
              <li key={jobId(j)} className="min-w-0 space-y-2 px-4 py-3">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="break-words text-base font-semibold text-ink">{jobDocType(j, locale)}</span>
                  <StatusBadge tone={toneJob(jobStatus(j), j.error)} label={labelJob(jobStatus(j), j.error, locale, j)} />
                </div>
                <p className="truncate font-mono text-xs text-ink-3" dir="ltr" title={jobId(j)}>{jobId(j)}</p>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
                  <span className="min-w-0 break-words">{String(s.printers.find((p) => p.id === jobPrinterId(j))?.name || jobPrinterId(j) || "—")}</span>
                  <span aria-hidden>·</span>
                  <span>{formatDateTime(jobTimestamp(j, "updatedAt"))}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden min-w-0 overflow-x-auto lg:block">
            <table className="data-table min-w-[720px] text-base">
              <thead><tr><th>{t("desktop.overview.colDocument")}</th><th>{t("desktop.overview.colPrinter")}</th><th>{t("desktop.overview.colStatus")}</th><th className="text-end">{t("desktop.overview.colUpdated")}</th></tr></thead>
              <tbody>{s.jobs.slice(0, 5).map((j) => (<tr key={jobId(j)}><td><div className="break-words text-base font-semibold text-ink">{jobDocType(j, locale)}</div><div className="font-mono text-xs text-ink-3">{jobId(j)}</div></td><td className="text-ink-2">{String(s.printers.find((p) => p.id === jobPrinterId(j))?.name || jobPrinterId(j) || "—")}</td><td><StatusBadge tone={toneJob(jobStatus(j), j.error)} label={labelJob(jobStatus(j), j.error, locale, j)} /></td><td className="text-end text-xs text-ink-3">{formatDateTime(jobTimestamp(j, "updatedAt"))}</td></tr>))}</tbody>
            </table>
          </div>
          </>
        )}
      </Card>


    </div>
  );
}
