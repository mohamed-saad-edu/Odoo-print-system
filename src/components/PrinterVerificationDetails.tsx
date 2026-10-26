"use client";

import { useI18n } from "../i18n/react";
import { Callout, KeyValueList } from "./ui";
import { isPrinterOperationallyVerified, validatePrinterOperationalVerification, type OperationalPrinterState } from "../lib/printer-operational-verification";
import { printOutputPresentation } from "../lib/print-output";

export function PrinterVerificationDetails({ printer }: { printer: OperationalPrinterState & { localObservedAt?: number } }) {
  const { t, formatDateTime } = useI18n();
  const caps = printer.capabilities && typeof printer.capabilities === "object" ? printer.capabilities as Record<string, unknown> : {};
  const native = typeof printer.localObservedAt === "number" ? validatePrinterOperationalVerification(caps.operational_verification, printer) : null;
  const verified = native ? native.ok : isPrinterOperationallyVerified(printer);
  const file = printer.connectionType === "pdf_output" || printer.outputMedium === "file";
  const verifiedAt = native?.ok ? native.value.verified_at : printer.verificationVerifiedAt;
  return <section className="space-y-3" aria-label={t("printer.verification.title")}>
    <h3 className="text-sm font-semibold text-ink">{t("printer.verification.title")}</h3>
    <KeyValueList rows={[
      { label: t("common.status"), value: t(verified ? "printer.verification.verified" : "printer.verification.pending") },
      { label: t("printer.verification.outputMedium"), value: t(file ? "printer.verification.file" : "printer.verification.physical") },
      { label: t("printer.verification.lastVerified"), value: verifiedAt ? formatDateTime(verifiedAt) : "—" },
    ]} />
    {!verified && <Callout tone="warn">{t("printer.verification.pendingHelp")}</Callout>}
  </section>;
}

export function FileOutputDetails({ job }: { job: { status?: unknown; error?: unknown; outputMedium?: unknown; outputEvidence?: unknown } }) {
  const { t, formatNumber } = useI18n();
  if (job.outputMedium !== "file") return null;
  const output = printOutputPresentation({ status: String(job.status ?? ""), error: typeof job.error === "string" ? job.error : null, outputMedium: "file", outputEvidence: job.outputEvidence });
  const evidence = output.outputEvidence;
  const error = typeof job.error === "string" ? job.error.trim().toLowerCase() : "";
  const errorKey = error.includes("access denied") || error.includes("access is denied") || error.includes("permission")
    ? "printer.verification.fileAccessDenied"
    : error.includes("not found") || error.includes("no such") ? "printer.verification.fileMissingOutput"
      : error.includes("timeout") || error.includes("timed out") || error.includes("deadline") ? "printer.verification.fileTimeout"
        : "printer.verification.fileDiagnostic";
  return <section className="space-y-3" aria-label={t("printer.verification.file")}>
    <Callout tone={evidence ? "ok" : "warn"}>{t(evidence ? "printer.verification.fileCreated" : output.outputOutcome === "pending" ? "printer.verification.fileQueued" : output.outputOutcome === "not_created" ? "printer.verification.fileFailed" : "printer.verification.fileUncertain")}</Callout>
    {error && <Callout tone="warn">{t(errorKey)}</Callout>}
    {evidence && <KeyValueList rows={[
      { label: t("printer.verification.artifactId"), value: evidence.artifact_id },
      { label: t("printer.verification.pages"), value: formatNumber(evidence.page_count) },
      { label: t("printer.verification.bytes"), value: formatNumber(evidence.bytes) },
      { label: "SHA-256", value: <span className="break-all font-mono text-xs">{evidence.sha256}</span> },
    ]} />}
  </section>;
}
