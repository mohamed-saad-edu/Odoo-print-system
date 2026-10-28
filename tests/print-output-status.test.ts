import { describe, expect, it } from "vitest";
import { printOutputPresentation } from "../src/lib/print-output";

const artifact = { output_medium: "file", artifact_id: "artifact_01", sha256: "a".repeat(64), page_count: 2, bytes: 1024 };

describe("file artifact and physical output are separate evidence types", () => {
  it.each(["queued", "claimed", "printing"])("%s file output remains pending", status => {
    expect(printOutputPresentation({ status, outputMedium: "file" })).toMatchObject({
      outputOutcome: "pending", physicalOutcome: "unknown", outputEvidence: null,
    });
  });
  it("does not claim a PDF file exists from transport success alone", () => {
    expect(printOutputPresentation({ status: "success", outputMedium: "file" }).outputOutcome).toBe("unknown");
    expect(printOutputPresentation({ status: "success", outputMedium: "file", outputEvidence: artifact })).toMatchObject({
      outputOutcome: "file_created", physicalOutcome: "unknown", outputEvidence: artifact,
    });
  });
  it("retains definite pre-dispatch failure versus ambiguous outcome", () => {
    expect(printOutputPresentation({ status: "failed", error: "CAPABILITY_MISMATCH", outputMedium: "file" }).outputOutcome).toBe("not_created");
    expect(printOutputPresentation({ status: "failed", error: "UNKNOWN_PARTIAL_DELIVERY", outputMedium: "file" }).outputOutcome).toBe("unknown");
  });
});
