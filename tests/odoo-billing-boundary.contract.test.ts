import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("Odoo billing control-plane contracts", () => {
  it("keeps Gateway activation entitlement and mutation inside one transaction", () => {
    const source = read("src/app/api/odoo/configuration/route.ts");
    expect(source).toContain("await db.transaction(async (tx) => {");
    expect(source).toContain("await requireTenantBillingAccess(tx, apiKey.tenantId);");
    expect(source).not.toContain("db.query.tenantSubscriptions.findFirst");
    expect(source).not.toContain("isBillingAccessStatus(");
    expect(source).not.toContain("isSubscriptionPeriodLive(");
  });

  it("keeps new Odoo API-key creation entitlement and insertion inside one transaction", () => {
    const source = read("src/app/api/odoo/keys/route.ts");
    expect(source).toContain("await db.transaction(async (tx) => {");
    expect(source).toContain("await requireTenantBillingAccess(tx, manager.tenantId);");
    expect(source).not.toContain("db.query.tenantSubscriptions.findFirst");
    expect(source).not.toContain("isBillingAccessStatus(");
    expect(source).not.toContain("isSubscriptionPeriodLive(");
  });

  it("makes Odoo agent discovery use the canonical database-authoritative billing predicate", () => {
    const source = read("src/app/api/odoo/agents/route.ts");
    expect(source).toContain("await requireTenantBillingAccess(tx, apiKey.tenantId);");
    expect(source).not.toContain("db.query.tenantSubscriptions.findFirst");
    expect(source).not.toContain("isBillingAccessStatus(");
    expect(source).not.toContain("isSubscriptionPeriodLive(");
  });

  it("requires active billing access before exposing Odoo printer inventory", () => {
    const source = read("src/app/api/odoo/printers/route.ts");
    expect(source).toContain("await requireTenantBillingAccess(tx, apiKey.tenantId);");
  });

  it("holds the tenant lifecycle fence before subscription admission in both inventory routes", () => {
    for (const path of ["src/app/api/odoo/agents/route.ts", "src/app/api/odoo/printers/route.ts"]) {
      const source = read(path);
      expect(source).toContain("await requireActiveTenantInTransaction(tx, apiKey.tenantId);");
      expect(source.indexOf("await requireActiveTenantInTransaction(tx, apiKey.tenantId);"))
        .toBeLessThan(source.indexOf("await requireTenantBillingAccess(tx, apiKey.tenantId);"));
    }
  });

  it("decides Odoo runtime access and reads the inventory in one transaction", () => {
    // A subscription that lapses between the billing decision and the
    // inventory read must not still expose tenant runtime state. Both
    // read surfaces therefore take the subscription row lock and read
    // inside the same transaction.
    for (const file of ["src/app/api/odoo/agents/route.ts", "src/app/api/odoo/printers/route.ts"]) {
      const source = read(file);
      expect(source).toContain("await db.transaction(async (tx) => {");
      expect(source).toContain("await requireTenantBillingAccess(tx, apiKey.tenantId);");
    }
  });
});
