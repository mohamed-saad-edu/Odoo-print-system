// @vitest-environment jsdom
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../src/i18n/react";
import { PrinterVerificationDetails, FileOutputDetails } from "../src/components/PrinterVerificationDetails";
import { jobDisplayLabel } from "../src/shared/job-vocabulary";
import { verifiedPrinterState } from "./helpers/printer-verification";
const evidence = { output_medium: "file", artifact_id: "artifact_42", sha256: "a".repeat(64), page_count: 2, bytes: 4096 };
const render = (child: React.ReactNode, locale: "en" | "ar" = "en") => renderToStaticMarkup(h(I18nProvider, { initialLocale: locale, children: child }));
describe("existing printer and job details show verification and file output honestly", () => {
  it("shows unproven online registrations as pending rather than verified", () => {
    const html = render(h(PrinterVerificationDetails, { printer: { id: "pending", connectionType: "spooler", protocol: "spooler" } }));
    expect(html).toContain("Pending verification"); expect(html).toContain("must verify this exact queue"); expect(html).not.toContain("Verified Agent access");
  });
  it("labels a recent verified file profile without exposing directory paths", () => {
    const html = render(h(PrinterVerificationDetails, { printer: { ...verifiedPrinterState(), connectionType: "pdf_output", protocol: "pdf", outputMedium: "file" } }));
    expect(html).toContain("Verified Agent access"); expect(html).toContain("Approved PDF file output");
  });
  it.each(["en", "ar"] as const)("renders bounded file evidence and a file-created label in %s", (locale) => {
    const job = { status: "success", outputMedium: "file", outputEvidence: evidence };
    const html = render(h(FileOutputDetails, { job }), locale);
    expect(html).toContain("artifact_42"); expect(html).toContain(evidence.sha256);
    expect(jobDisplayLabel("success", null, locale, job)).toBe(locale === "en" ? "PDF file created and verified" : "تم إنشاء ملف PDF والتحقق منه");
  });
  it("refuses a successful-file label when artifact evidence is missing or contains a path", () => {
    for (const outputEvidence of [null, { ...evidence, filename: "/private/path.pdf" }]) {
      const job = { status: "success", outputMedium: "file", outputEvidence };
      expect(jobDisplayLabel("success", null, "en", job)).toContain("not confirmed");
      expect(render(h(FileOutputDetails, { job }))).not.toContain("/private/path.pdf");
    }
  });
});
