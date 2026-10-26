import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Yaseir customer UX: concise, state-driven setup", () => {
  it("shows operational state rather than another onboarding tutorial on the dashboard", () => {
    const source = read("src/app/dashboard/dashboard-client.tsx");
    expect(source).not.toContain('open={kpis.totalAgents === 0}');
    expect(source).not.toContain('t("v4.experience.setup.body")');
    expect(source).toContain('kpis.totalAgents === 0 && canMutate.agentsPair');
    expect(source).toContain('href="#printers"');
    expect(source).toContain('dashboard.fleetSummary');
  });
  it("hides Odoo setup instructions after a credential is enabled, without hiding recovery tools", () => {
    const source = read("src/app/api-keys/page.tsx");
    expect(source).toContain('{enabled === 0 && <details className="card group overflow-hidden">');
    expect(source).toContain('enabled === 0 && <Callout tone="info"');
    expect(source).not.toContain('v4.connection.advanced');
    expect(source).toContain('title={t("apiKeys.credentials")}');
    expect(source).toContain('v4.connection.rotate');
  });
  it("shows the setup checklist on demand and calls active subscription what it actually is", () => {
    const source = read("src/app/onboarding/page.tsx");
    const words = read("src/i18n/messages/v4-onboarding.ts");
    expect(source).toContain('redirect("/dashboard")');
    expect(source).not.toContain('subscription-requests');
    expect(words).toContain('"v4.onboarding.ready": "Subscription active"');
    expect(words).toContain('"v4.onboarding.ready": "الاشتراك نشط"');
  });
  it("keeps account security and settings controls while removing repeated page intros", () => {
    const source = read("src/app/settings/page.tsx");
    expect(source).not.toContain('description={t("v4.experience.settings.body")}');
    expect(source).toContain('securityRequested');
  });
});
