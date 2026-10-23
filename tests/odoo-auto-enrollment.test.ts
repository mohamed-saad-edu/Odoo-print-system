import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const file = (path: string) => readFileSync(path, "utf8");

describe("zero-touch Odoo v2 enrollment contracts", () => {
  it("does not expose manual installation or cutover controls to Odoo customers", () => {
    const view = file("odoo_addons/print_gateway/views/gateway_config_views.xml");
    expect(view).not.toContain('name="installation_id"');
    expect(view).not.toContain('name="idempotency_v2_enabled"');
    expect(view).toContain('name="gateway_api_key"');
  });

  it("uses v2 for all newly created Odoo print operations", () => {
    const job = file("odoo_addons/print_gateway/models/print_job.py");
    expect(job).toContain("namespace_version = 2");
    expect(job).toContain("gateway_config._ensure_auto_installation()");
    expect(job).toContain("gateway_config._register_auto_installation(self.gateway_installation_id)");
    expect(job).toContain("gateway_wire_idempotency_key");
  });

  it("binds automatic enrollment to a live Odoo API key and the tenant", () => {
    const endpoint = file("src/app/api/odoo/installations/auto/route.ts");
    expect(endpoint).toContain("validateOdooKey");
    expect(endpoint).toContain("requireActiveTenantInTransaction");
    expect(endpoint).toContain("requireTenantBillingAccess");
    expect(endpoint).toContain("proofMatches");
    expect(endpoint).toContain("INSTALLATION_OWNERSHIP_CONFLICT");
    expect(endpoint).not.toContain("installationProof: installationProof");
  });

  it("preserves the old operator-only API and immutable receipt history", () => {
    const old = file("src/app/api/odoo/installations/route.ts");
    expect(old).toContain("validateWorkspaceManager");
    expect(old).toContain("requireManagerPermission");
    const migration = file("drizzle/0087_odoo_auto_enrollment.sql");
    expect(migration).not.toMatch(/UPDATE\s+"?print_jobs"?/i);
    expect(migration).not.toMatch(/DELETE\s+FROM/i);
  });
});
