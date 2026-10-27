import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(path, "utf8");
const retired = ["stripe_price_id", "stripe_price_history", "stripe_product_id", "stripe_customer_id", "stripe_subscription_id", "checkout_session_id", "checkout_status", "billing_operation_id", "billing_mode"];
describe("forward-only manual billing schema", () => {
  it("no longer exposes a provider checkout column in runtime schema or owner API", () => {
    const schema = read("src/db/schema.ts");
    const plans = read("src/app/api/platform/plans/route.ts");
    const explorer = read("src/lib/platform-data-explorer.ts");
    for (const name of retired) expect(schema).not.toContain(`"${name}"`);
    expect(plans).not.toContain("stripe");
    expect(explorer).toContain("RETIRED_COLUMNS");
  });
  it("preserves historical journal and advances with a single migration", () => {
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: Array<{ tag: string }> };
    expect(journal.entries.map(entry => entry.tag)).toContain("0098_manual_only_billing");
    expect(journal.entries.at(-1)?.tag).toBe("0100_plan_prices");
    const approvalMigration = read("drizzle/0099_subscription_approval_terms.sql");
    expect(approvalMigration).toContain("approved_term");
    expect(approvalMigration).toContain("approval_modified");
    const migration = read("drizzle/0098_manual_only_billing.sql");
    for (const column of retired) expect(migration).toContain(column);
    expect(migration).toContain("PROVIDER_BILLING_RETIREMENT_V1");
    expect(migration).toContain("legacy_billing");
    expect(migration).toContain("manual_review_required");
    expect(read("scripts/db-migrate.ts")).toContain("retiredRepair");
  });
  it("all former billing POST routes fail closed without an active provider integration", () => {
    for (const route of ["checkout", "webhook", "cancel", "resume", "portal"]) {
      const source = read(`src/app/api/billing/${route}/route.ts`);
      expect(source).toContain("MANUAL_BILLING_REQUIRED");
      expect(source).toMatch(/status:\s*410/);
    }
  });
});
