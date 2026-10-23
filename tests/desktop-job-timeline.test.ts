import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JobTimeline } from "../src/desktop/components/JobTimeline";

describe("desktop job timeline evidence", () => {
  for (const status of ["claimed", "printing"]) {
    it(`keeps ${status} in progress while its physical outcome is unverified`, () => {
      const markup = renderToStaticMarkup(createElement(JobTimeline, { status }));
      expect(markup).toContain("in progress");
      expect(markup).not.toContain("needs attention");
      expect(markup).not.toContain("text-warn");
    });
  }

  it("retains attention for terminal failures whose paper outcome is unknown", () => {
    const markup = renderToStaticMarkup(createElement(JobTimeline, {
      status: "failed", error: "UNKNOWN_PARTIAL_DELIVERY: lost acknowledgment",
    }));
    expect(markup).toContain("needs attention");
    expect(markup).toContain("text-warn");
    expect(markup).not.toContain("in progress");
  });

  it("retains an unreached outcome for queued jobs", () => {
    const markup = renderToStaticMarkup(createElement(JobTimeline, { status: "queued" }));
    expect(markup).not.toContain("needs attention");
    expect(markup).not.toContain("in progress");
    expect(markup).toContain("not reached");
  });
});
