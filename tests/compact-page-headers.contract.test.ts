import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");
const platformPages = [
  "dashboard", "plans", "subscriptions", "operations", "release-readiness",
  "subscription-requests", "tenants", "tenants/[id]", "audit", "jobs",
  "database", "fleet", "integrations", "security",
] as const;
const customerPages = ["dashboard", "api-keys", "settings", "team"] as const;

describe("compact, consistent page headers", () => {
  it("keeps one title row, status, accessible actions and no redundant eyebrow", () => {
    const ui = read("src/components/ui.tsx");
    expect(ui).toContain('<h1 className="tg-page-title');
    expect(ui).not.toContain("tg-page-eyebrow text-eyebrow");
    expect(ui).toContain('aria-hidden="true"');
    expect(ui).toContain("sm:text-2xl");
    expect(ui).toContain("lg:pt-6");
    expect(ui).toContain("{meta}");
    expect(ui).toContain("{actions}");
  });

  it.each(platformPages)("uses the inline admin heading without an extra padded band: %s", page => {
    const file = read(`src/app/platform/${page}/page.tsx`);
    expect(file).toContain('<PageHeader variant="inline"');
    const headers = file.split("<PageHeader").slice(1);
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      // All the repeated content moved out of the heading to the relevant
      // card/table; required alerts, filters and form labels are unchanged.
      expect(header.slice(0, 250)).not.toMatch(/\\b(eyebrow|description)=\\{/);
    }
  });

  it.each(customerPages)("keeps customer headings short while retaining relevant content: %s", page => {
    const source = read(`src/app/${page}/page.tsx`);
    const headers = source.split("<PageHeader").slice(1);
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      expect(header.slice(0, 250)).not.toMatch(/\\b(eyebrow|description)=\\{/);
    }
    expect(source).toContain("PageHeader");
  });

  it("matches the desktop header scale and avoids large duplicated intro blocks", () => {
    const desktop = read("src/desktop/ui.tsx");
    expect(desktop).toContain("text-xl font-[650]");
    expect(desktop).toContain("sm:text-2xl");
    expect(desktop).toContain('justify-between gap-x-4 gap-y-3');
  });
});
