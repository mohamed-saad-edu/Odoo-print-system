import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const state = fs.readFileSync("src/lib/dashboard-state.ts", "utf8");
const actions = fs.readFileSync("src/app/actions.ts", "utf8");
const page = fs.readFileSync("src/app/dashboard/page.tsx", "utf8");
const client = fs.readFileSync("src/app/dashboard/dashboard-client.tsx", "utf8");
const entitlements = fs.readFileSync("src/lib/entitlements.ts", "utf8");

test("dashboard fleet reads are page bounded while unlimited plans remain valid", () => {
  assert.match(entitlements, /EntitlementValue\s*=\s*number\s*\|\s*"unlimited"/);
  assert.match(state, /DASHBOARD_FLEET_PAGE_SIZE\s*=\s*100/);
  assert.ok((state.match(/\.limit\(DASHBOARD_FLEET_PAGE_SIZE \+ 1\)/g) ?? []).length >= 2);
  assert.match(state, /\.offset\(agentOffset\)/);
  assert.match(state, /\.offset\(printerOffset\)/);
  assert.doesNotMatch(state, /\.limit\(1000\).*\.offset\(0\)/s);
});

test("SSR and polling share the bounded fleet query instead of selecting whole fleets", () => {
  assert.match(page, /loadDashboardStateForTenant\(claims\.tenantId, \{\}, tx\)/);
  assert.match(page, /requireActiveTenantInTransaction\(tx, claims\.tenantId\)/);
  assert.match(page, /requireManagerActorInTransaction\(tx, claims, "jobs\.read"\)/);
  assert.doesNotMatch(page, /\.from\(agents\)/);
  assert.doesNotMatch(page, /\.from\(printers\)/);
  assert.match(actions, /getDashboardState\(options: DashboardFleetOptions = \{\}\)/);
  assert.match(actions, /loadDashboardStateForTenant\(manager\.tenantId/);
  assert.match(client, /getDashboardStateResult\(options\)/);
  assert.match(client, /getDashboardState\(currentQuery \?\? fleetQueryRef\.current\)/);
  assert.match(client, /fleet\.agentHasMore/);
  assert.match(client, /fleet\.printerHasMore/);
  assert.match(client, /common\.previousPage/);
  assert.match(client, /common\.nextPage/);
});

test("printer filtering is server-side and job labels do not depend on the visible fleet page", () => {
  assert.match(state, /printerFilterConditions\(tenantId, options, now\)/);
  assert.match(state, /LOWER\(\$\{printers\.name\}\) LIKE/);
  assert.match(state, /DASHBOARD_PRINTER_FILTER_STATUSES/);
  assert.match(client, /maxLength=\{64\}/);
  assert.match(client, /printerSearch: debouncedPrinterSearch/);
  assert.match(state, /agentName: agents\.name/);
  const history = fs.readFileSync("src/lib/job-history.ts", "utf8");
  assert.match(history, /a\.name AS "agentName"/);
  assert.match(history, /p\.name AS "printerName"/);
  assert.match(state, /listPrintJobHistory/);
  assert.match(actions, /listPrintJobHistory/);
  assert.match(client, /job\.printerName \?\? printer\?\.name/);
});

test("fleet KPIs use bounded aggregate results rather than page lengths", () => {
  assert.match(state, /totalAgents: Number\(agentSummary\.total/);
  assert.match(state, /onlineAgents: Number\(agentSummary\.online/);
  assert.match(state, /totalPrinters: Number\(printerSummary\.total/);
  assert.match(state, /onlinePrinters: Number\(printerSummary\.online/);
  assert.match(client, /const totalAgents = fleet\.totalAgents/);
  assert.match(client, /const totalPrinters = fleet\.totalPrinters/);
  assert.doesNotMatch(client, /const totalAgents = agents\.length/);
  assert.doesNotMatch(client, /const totalPrinters = printers\.length/);
});
