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
    // v10-exact: Gateway PageHeader follows Design Guide v2.1 page-title
    // scale (32–40px, weight 500) like Desktop — text-[2rem] base,
    // sm:text-4xl (36px) — instead of the old compact text-xl/2xl scale.
    expect(ui).toContain("text-[2rem] font-[500]");
    expect(ui).toContain("sm:text-4xl");
    expect(ui).toContain("lg:pt-6");
    expect(ui).toContain("{meta}");
    expect(ui).toContain("{actions}");
  });

  it.each(platformPages)("uses the inline admin heading without an extra padded band: %s", page => {
    const file = read(`src/app/platform/${page}/page.tsx`);
    expect(file).toMatch(/<PageHeader\s+variant="inline"/);
    const headers = file.split("<PageHeader").slice(1);
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      // All the repeated content moved out of the heading to the relevant
      // card/table; required alerts, filters and form labels are unchanged.
      expect(header.slice(0, 250)).not.toMatch(/\\b(eyebrow|description)=\\{/);
    }
  });

  it.each(customerPages)("keeps customer headings short while retaining relevant content: %s", page => {
    // WP5: WP8 moved the dashboard server implementation (including its
    // PageHeader) into the shared Operations loader; /dashboard/page.tsx
    // is a thin wrapper that renders it. Audit the loader for dashboard,
    // and prove the wrapper still renders it.
    const source = page === "dashboard"
      ? read("src/app/dashboard/dashboard-page-content.tsx")
      : read(`src/app/${page}/page.tsx`);
    if (page === "dashboard") {
      expect(read("src/app/dashboard/page.tsx")).toContain("DashboardPageContent");
    }
    const headers = source.split("<PageHeader").slice(1);
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      // The loader heading carries no eyebrow and no literal description
      // block: its description prop is only a conditional short-key
      // passthrough (undefined on Home, a short key on locked sub-pages).
      expect(header.slice(0, 250)).not.toMatch(/\beyebrow=\{/);
      expect(header.slice(0, 250)).not.toMatch(/description=\{t\(/);
      if (page !== "dashboard") {
        expect(header.slice(0, 250)).not.toMatch(/\bdescription=\{/);
      }
    }
    expect(source).toContain("PageHeader");
  });

  it("matches the desktop header scale and avoids large duplicated intro blocks", () => {
    const desktop = read("src/desktop/ui.tsx");
    // v8-style: Desktop PageHeader follows Design Guide v2.1 page-title scale
    // (32–40px, weight 500) instead of the old text-xl/650 scale.
    expect(desktop).toContain("text-4xl font-medium");
    expect(desktop).not.toContain("text-xl font-[650]");
    expect(desktop).toContain('justify-between gap-x-4 gap-y-3');
  });
});
