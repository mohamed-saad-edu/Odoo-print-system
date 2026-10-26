import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverviewPage } from "../src/desktop/pages/Overview";
import type { DesktopState } from "../src/desktop/types";
import { I18nProvider } from "../src/i18n/react";
import { translate } from "../src/i18n/translate";
import { FileOutputDetails } from "../src/components/PrinterVerificationDetails";

describe("Desktop Overview output evidence", () => {
  it.each(["en", "ar"] as const)("keeps file creation separate from printer submission in %s", locale => {
    const evidence = { output_medium: "file", artifact_id: "artifact-1", sha256: "a".repeat(64), page_count: 1, bytes: 1024 };
    for (const outputEvidence of [null, evidence]) {
      const state = {
        printers: [], discoveredPrinters: [], localPrinters: [], nowMs: Date.now(),
        gatewayUrl: "", gatewayConnected: false, agentStatus: { running: false },
        isOnline: false, pendingJobs: 0, failedJobs: 0, jobsLoading: false,
        jobs: [{ id: "file-job", printerId: "file-profile", status: "success", documentType: "invoice", outputMedium: "file", outputEvidence }],
      } as unknown as DesktopState;
      const html = renderToStaticMarkup(createElement(I18nProvider,
        { initialLocale: locale } as ComponentProps<typeof I18nProvider>,
        createElement(OverviewPage, { s: state }),
      ));
      expect(html).toContain(translate(locale, outputEvidence ? "printer.verification.fileCreated" : "printer.verification.fileUncertain"));
      expect(html).not.toContain(translate(locale, "v4.experience.job.sent"));
    }
  });

  it("preserves ordinary physical transport submission labels", () => {
    const state = {
      printers: [], discoveredPrinters: [], localPrinters: [], nowMs: Date.now(),
      gatewayUrl: "", gatewayConnected: false, agentStatus: { running: false },
      isOnline: false, pendingJobs: 0, failedJobs: 0, jobsLoading: false,
      jobs: [{ id: "physical-job", printerId: "printer", status: "success", documentType: "invoice", outputMedium: "physical" }],
    } as unknown as DesktopState;
    expect(renderToStaticMarkup(createElement(OverviewPage, { s: state }))).toContain(translate("en", "v4.experience.job.sent"));
  });

  it.each([
    ["write C:\\private\\output.pdf: access is denied; secret=hidden", "Check the permissions of the approved output directory."],
    ["approved profile directory not found: C:\\private\\output.pdf", "Check the approved output profile and directory on the Agent."],
    ["UNKNOWN_SUBMISSION_OUTCOME: deadline exceeded for C:\\private\\output.pdf", "Check the output and original job before repeating the file operation."],
    ["unexpected failure at C:\\private\\output.pdf; secret=hidden", "Review the Agent diagnostics for this original file operation."],
  ])("retains safe file failure guidance for %s", (error, guidance) => {
    const html = renderToStaticMarkup(createElement(FileOutputDetails, { job: { status: "failed", outputMedium: "file", error } }));
    expect(html).toContain(guidance);
    expect(html).not.toContain("private");
    expect(html).not.toContain("secret=hidden");
    expect(html).not.toContain("Sent to printer");
  });

  it("localizes safe file failure guidance in Arabic", () => {
    const html = renderToStaticMarkup(createElement(I18nProvider,
      { initialLocale: "ar" } as ComponentProps<typeof I18nProvider>,
      createElement(FileOutputDetails, { job: { status: "failed", outputMedium: "file", error: "access denied: C:\\private\\output.pdf" } }),
    ));
    expect(html).toContain(translate("ar", "printer.verification.fileAccessDenied"));
    expect(html).not.toContain("private");
    expect(html).not.toContain(translate("en", "printer.verification.fileAccessDenied"));
  });
});
