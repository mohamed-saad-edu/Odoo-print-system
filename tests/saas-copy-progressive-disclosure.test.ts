import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
describe("SaaS copy and progressive disclosure", () => {
  it("does not expand Odoo setup instructions by default", () => {
    const page = read("src/app/api-keys/page.tsx");
    expect(page).toContain('<details className="card group overflow-hidden">');
    expect(page).not.toContain('<details open className="card group overflow-hidden">');
    expect(page).toContain('enabled === 0 && <Callout tone="info"');
    expect(page).toContain('enabled === 0 && <p className="text-sm text-ink-3">');
  });
  it("keeps warnings for inactive subscriptions without flooding active customers", () => {
    const billing = read("src/app/billing/page.tsx");
    const home = read("src/app/page.tsx");
    expect(billing).toContain('redirect("/platform/subscriptions")');
    expect(home).toContain('customerSubscriptionState(subscription, tenant?.lifecycle, await databaseNowMs())');
    expect(home).toContain('subscriptionStatus === "active"');
    expect(billing).not.toContain('v4.subscription.nextReset');
  });
  it("keeps the operations dashboard concise while retaining failure alerts", () => {
    const page = read("src/app/dashboard/page.tsx");
    expect(page).not.toContain('description={t("v4.experience.health.body")}');
    expect(page).toContain('dashboard.page.dbUnavailableBody');
  });
});
