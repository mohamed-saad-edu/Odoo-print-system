import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Dashboard SSR and server actions use live tenant/member authority", () => {
  it("keeps the full fleet and job-history snapshot inside a transaction-scoped reader", () => {
    const reader = readFileSync("src/lib/dashboard-state.ts", "utf8");
    // WP5: WP8 moved the dashboard server implementation verbatim into the
    // shared Operations loader; /dashboard/page.tsx is now a thin wrapper
    // that renders it. Audit the loader, and prove the route still uses it.
    const page = readFileSync("src/app/dashboard/dashboard-page-content.tsx", "utf8");
    const wrapper = readFileSync("src/app/dashboard/page.tsx", "utf8");
    expect(wrapper).toContain("DashboardPageContent");
    const actions = readFileSync("src/app/actions.ts", "utf8");

    expect(reader).toContain("tx?: DbTx");
    expect(reader).toContain("const executor = tx ?? db;");
    expect(reader).toContain("listPrintJobHistory({ tenantId, limit: 50 }, tx)");
    expect(page).toContain("await db.transaction(async tx => {");
    expect(page).toContain("await requireActiveTenantInTransaction(tx, claims.tenantId);");
    expect(page).toContain('await requireManagerActorInTransaction(tx, claims, "jobs.read");');
    expect(page).toContain("loadDashboardStateForTenant(claims.tenantId, {}, tx)");
    expect(actions).toContain('await requireManagerActorInTransaction(tx, manager, "jobs.read");');
    expect(actions).toContain("listPrintJobHistory({");
    expect(actions).toContain("}, tx);");
    expect(actions).toContain("loadDashboardStateForTenant(manager.tenantId, {");
  });
});
