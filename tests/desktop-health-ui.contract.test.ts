import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("desktop attention counts include unknown and stale printers", () => {
  it("Agents fleet stat never reports ok with only unknown/stale printers", () => {
    const agents = readFileSync("src/desktop/pages/Agents.tsx", "utf8");
    expect(agents).toContain("printerHealthCounts(physical, s.nowMs)");
    expect(agents).toContain("const attention = offline + unknown;");
  });

  it("Overview printer stat surfaces unknown printers instead of ok", () => {
    const overview = readFileSync("src/desktop/pages/Overview.tsx", "utf8");
    expect(overview).toContain("offline + unknownPrinters");
    // Keyboard focus must stay visible on the printer row button.
    expect(overview).not.toContain("focus:outline-none");
    expect(overview).toContain("focus-visible:ring-");
  });
});
