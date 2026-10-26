import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("desktop localized date direction", () => {
  it("uses locale-aware timestamps for recent jobs without forcing left-to-right date text", () => {
    const overview = readFileSync("src/desktop/pages/Overview.tsx", "utf8");
    expect(overview).toContain('formatDateTime(jobTimestamp(j, "updatedAt"))');
    expect(overview).not.toContain('dir="ltr">{formatDateTime');
  });
});
