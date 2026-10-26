test("printer scope choices remain unique when legacy Odoo returns identical company names", async () => {
  const { labelPrinterScopes } = await load("js/printer_scope_labels.js");
  const raw = [
    { id: 11, name: "My Company", companyId: 11, branchId: false },
    { id: 12, name: "My Company", companyId: 11, branchId: 12 },
    { id: 24, name: " MY COMPANY ", companyId: 24, branchId: false },
    { id: 27, name: "Alexandria", companyId: 11, branchId: 27 },
    { id: 12, name: "My Company", companyId: 11, branchId: 12 },
    { id: "bad", name: "Invalid", companyId: 11, branchId: false },
  ];
  const result = Array.from(labelPrinterScopes(raw, { company: "Company", branch: "Branch" }));
  assert.deepEqual(result.map(x => x.id), [11, 12, 24, 27]);
  assert.deepEqual(result.map(x => x.label), [
    "Company: My Company (#11)",
    "Branch: My Company",
    "Company: MY COMPANY (#24)",
    "Branch: Alexandria",
  ]);
  assert.equal(new Set(result.map(x => x.label.toLowerCase())).size, result.length);
  assert.deepEqual(result.map(x => [x.companyId, x.branchId]), [[11, false], [11, 12], [24, false], [11, 27]]);
  assert.deepEqual(raw[0], { id: 11, name: "My Company", companyId: 11, branchId: false }, "must not mutate server scopes");
});

test("legacy server suffix-shaped names never collide after client disambiguation", async () => {
  const { labelPrinterScopes } = await load("js/printer_scope_labels.js");
  const input = [
    { id: 1, name: "My Company", companyId: 1, branchId: false },
    { id: 2, name: "My Company", companyId: 2, branchId: false },
    { id: 3, name: "My Company (#2)", companyId: 3, branchId: false },
  ];
  const results = Array.from(labelPrinterScopes(input));
  assert.equal(new Set(results.map(scope => scope.label.toLocaleLowerCase())).size, results.length,
    "even a literal suffix in the original company name must not duplicate the final visible labels");
  assert.deepEqual(results.map(scope => scope.id), [1, 2, 3]);
});

test("disabled scope status suffix cannot mimic an assignable company name", async () => {
  const { labelPrinterScopes } = await load("js/printer_scope_labels.js");
  const input = [
    { id: 1, name: "My Company", companyId: 1, branchId: false, assignable: false },
    { id: 2, name: "My Company (Unavailable)", companyId: 2, branchId: false },
  ];
  const labels = Array.from(labelPrinterScopes(input), scope => scope.label.toLocaleLowerCase());
  assert.equal(new Set(labels).size, labels.length,
    "the appended unavailable status must not create an ambiguous final option label");
});

test("already disambiguated Odoo scopes keep server labels and do not gain extra suffixes", async () => {
  const { labelPrinterScopes } = await load("js/printer_scope_labels.js");
  const scopes = [
    { id: 1, name: "My Company (#1)", companyId: 1, branchId: false },
    { id: 2, name: "My Company (#2)", companyId: 2, branchId: false },
    { id: 3, name: "My Company / Branch", companyId: 1, branchId: 3 },
  ];
  assert.deepEqual(Array.from(labelPrinterScopes(scopes), x => x.label), [
    "Company: My Company (#1)", "Company: My Company (#2)", "Branch: My Company / Branch",
  ]);
  assert.deepEqual(Array.from(labelPrinterScopes([])), []);
  assert.deepEqual(Array.from(labelPrinterScopes(null)), []);
});

import { receiptGeometry, verifiedPrinter } from "./helpers/odoo-printer-geometry.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve("odoo_addons/print_gateway/static/src");

async function load(relative, extra = {}, overrides = {}) {
  const registry = { category: () => ({ add() {}, contains: () => false }) };
  const stubs = {
    "@odoo/owl": { Component: class {}, onWillStart() {}, onWillUnmount() {}, onMounted() {}, useEffect() {}, useState: v => v, xml: () => "" },
    "@web/core/registry": { registry },
    "@web/core/network/rpc": { rpc() {} },
    "@web/core/l10n/translation": { _t: value => value },
    "@web/core/browser/browser": { browser: {} },
    "@web/core/dropdown/dropdown": { Dropdown: class {} },
    "@web/core/dropdown/dropdown_item": { DropdownItem: class {} },
    "@web/core/user": { user: { lang: "en_US", userId: 4 } },
    "@web/core/utils/hooks": { useService() {} },
    ...overrides,
  };
  const context = vm.createContext({ console, setTimeout, clearTimeout, ...extra });
  const modules = new Map();
  async function moduleFor(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const sourceModule = new vm.SourceTextModule(fs.readFileSync(filename, "utf8"), { context, identifier: filename });
    modules.set(filename, sourceModule);
    await sourceModule.link(async (id, importing) => {
      if (stubs[id]) return new vm.SyntheticModule(Object.keys(stubs[id]), function () {
        for (const [key, value] of Object.entries(stubs[id])) this.setExport(key, value);
      }, { context });
      assert.ok(id.startsWith("."), `unknown external Odoo import ${id}`);
      return moduleFor(path.resolve(path.dirname(importing.identifier), `${id}.js`));
    });
    return sourceModule;
  }
  const entryModule = await moduleFor(path.join(root, relative));
  await entryModule.evaluate();
  return entryModule.namespace;
}



test("printer selector prioritizes explicit branch, never falls through revoked scopes", async () => {
  const { resolvePrinterScopeSelection } = await load("js/printer_scope_labels.js");
  const normalizedSelection = (...args) => {
    const result = resolvePrinterScopeSelection(...args);
    return { id: result.id, invalidated: result.invalidated };
  };
  const scopes = [
    { id: 5, name: "My Company", companyId: 5, branchId: false },
    { id: 6, name: "My Company / My Company", companyId: 5, branchId: 6 },
    { id: 8, name: "Other Company", companyId: 8, branchId: false },
    { id: 9, name: "Unsupported nested", companyId: 5, branchId: 9, assignable: false },
  ];
  assert.deepEqual(normalizedSelection(scopes, {
    requestedCompanyId: "5", requestedBranchId: "6", currentCompanyId: 5,
  }), { id: 6, invalidated: false });
  assert.deepEqual(normalizedSelection(scopes, {
    requestedCompanyId: "5", requestedBranchId: "7", currentCompanyId: 5,
  }), { id: 0, invalidated: true });
  assert.deepEqual(normalizedSelection(scopes, {
    requestedCompanyId: "8", currentCompanyId: 5,
  }), { id: 8, invalidated: false });
  assert.deepEqual(normalizedSelection(scopes, {
    currentCompanyId: 11,
  }), { id: 0, invalidated: true });
  assert.deepEqual(normalizedSelection(scopes, {
    currentCompanyId: 9,
  }), { id: 0, invalidated: true });
  assert.deepEqual(normalizedSelection(scopes, {
    currentCompanyId: 5,
  }), { id: 5, invalidated: false });
  assert.deepEqual(normalizedSelection([], { currentCompanyId: 5 }),
    { id: 0, invalidated: true });
});

test("monthly allowance reset shows the exact UTC boundary from Saudi and western browser timezones", async () => {
  for (const browserZone of ["Asia/Riyadh", "America/Los_Angeles"]) {
    const dialogs = [];
    const { showGatewayBillingLimitDialog } = await load("js/gateway_limit_dialog.js", {
      Intl: { DateTimeFormat: function (_locale, options) {
        return new Intl.DateTimeFormat("en-US", { timeZone: browserZone, ...options });
      } },
    }, {
      "@web/core/confirmation_dialog/confirmation_dialog": { ConfirmationDialog: class {} },
      "@web/core/l10n/translation": { _t: (message, ...values) => {
        let index = 0;
        return message.replace(/%s/g, () => String(values[index++]));
      } },
    });
    assert.equal(showGatewayBillingLimitDialog({ services: {
      dialog: { add: (_component, props) => dialogs.push(props) }, action: {},
    } }, {
      entitlement: "max_prints_per_period", message: "Allowance reached",
      used: 100, limit: 100, retryAfterSeconds: null, periodEnd: "2026-11-01T00:00:00Z",
    }), true);
    assert.match(dialogs[0].body, /Monthly allowance resets: Nov 1, 2026, 12:00 AM UTC/,
      `The commercial boundary must not shift with browser timezone ${browserZone}`);
  }
});

test("POS picker offers only physical JPEG transports and declared ESC/POS raster capability", async () => {
  const { RuntimePrinterField } = await load("components/runtime_printer_field.js");
  const field = Object.create(RuntimePrinterField.prototype);
  const cases = [
    ["queue", "spooler", "spooler", undefined, true],
    ["legacy-queue", "windows_spooler", "windows_spooler", undefined, false],
    ["usb-queue", "usb", "spooler", undefined, false],
    ["legacy-usb-queue", "usb", "windows_spooler", undefined, false],
    ["tcp-driver-label", "network", "spooler", undefined, false],
    ["tcp-legacy-label", "network", "windows_spooler", undefined, false],
    ["wrong-transport", "serial", "spooler", undefined, false],
    ["escpos", "network", "escpos", undefined, true],
    ["explicit-raster", "network", "escpos", [" JPEG "], true],
    ["explicit-escpos", "network", "escpos", [" ESCPos "], true],
    ["explicit-image", "network", "escpos", ["image"], true],
    ["conflict", "network", "escpos", ["zpl"], false],
    ["empty", "network", "escpos", [], false],
    ["malformed", "network", "escpos", "escpos", false],
    ["null", "network", "escpos", null, false],
    ["direct-usb", "usb", "escpos", ["image"], true],
    ["ipp-document", "ipp", "ipp", ["image"], false],
  ];
  field.props = { record: { data: {} } };
  field.state = { destinationType: "pos", printers: cases.map(([id, connectionType, protocol, supported]) => verifiedPrinter({
    id, connectionType, protocol, capabilities: { geometry: receiptGeometry(576, 203, id),
      ...(supported === undefined ? {} : { supported_protocols: supported }) },
  })) };
  const expected = cases.filter(row => row[4]).map(row => row[0]);
  assert.deepEqual(Array.from(field.filteredPrinters, row => row.id), expected);
  field.state.destinationType = "pos_printer";
  assert.deepEqual(Array.from(field.filteredPrinters, row => row.id), expected);
  field.state.destinationType = "report";
  assert.deepEqual(Array.from(field.filteredPrinters, row => row.id),
    ["queue", "escpos", "explicit-raster", "explicit-escpos", "explicit-image", "conflict", "empty", "malformed", "null", "direct-usb", "ipp-document"],
    "reports preserve format selection while unverified/noncanonical transports remain ineligible");
});

test("POS picker rejects unknown, mismatched or incomplete geometry before selecting a receipt destination", async () => {
  const { RuntimePrinterField } = await load("components/runtime_printer_field.js");
  const field = Object.create(RuntimePrinterField.prototype);
  field.props = { record: { data: {} } };
  const printer = (id, connectionType, changes = {}, absent = []) => {
    const geometry = { ...receiptGeometry(576, 203, id), ...changes };
    for (const key of absent) delete geometry[key];
    return { id, connectionType, protocol: connectionType === "spooler" ? "spooler" : "escpos",
      capabilities: { geometry } };
  };
  const printers = [
    { id: "unknown", connectionType: "spooler", protocol: "spooler", capabilities: {} },
    printer("wrong-id", "spooler", { printer_id: "different-printer" }),
    printer("no-dpi", "spooler", {}, ["dpi_y"]),
    printer("no-media", "spooler", {}, ["paper_width_mm"]),
    printer("raw-no-command", "usb", {}, ["raster_command"]),
    printer("raw-typography", "usb", {}, ["paper_width_mm"]),
    printer("driver-complete", "spooler"),
  ];
  field.state = { destinationType: "pos", printers: printers.map(verifiedPrinter) };
  for (const destinationType of ["pos", "pos_printer"]) {
    field.state.destinationType = destinationType;
    assert.deepEqual(Array.from(field.filteredPrinters, row => row.id), ["raw-typography", "driver-complete"]);
  }
});

test("synchronous RPC factory failure releases its timer/XHR and cannot later cancel a completed request", async () => {
  const timers = new Set();
  let aborted = 0;
  const { startRpcWithDeadline } = await load("js/async_control.js", {
    XMLHttpRequest: class { abort() { aborted += 1; } },
    setTimeout: callback => { timers.add(callback); return callback; },
    clearTimeout: timer => timers.delete(timer),
  });
  const failure = new Error("RPC setup failed");
  const request = startRpcWithDeadline(() => { throw failure; }, "/read-only", {});
  await assert.rejects(request.promise, error => error === failure);
  assert.equal(timers.size, 0);
  assert.equal(aborted, 1);
  request.cancel();
  assert.equal(aborted, 1, "settled request cancellation is a no-op");
});

test("language failure after unmount cannot notify, while a mounted failure still gives feedback", async () => {
  const { PrintGatewayLanguageSwitcher } = await load("components/language_switcher.js");
  for (const alive of [false, true]) {
    const messages = [];
    const field = Object.create(PrintGatewayLanguageSwitcher.prototype);
    field.alive = alive;
    field.orm = { write: async () => { throw new Error("language write failed"); } };
    field.notification = { add: (...args) => messages.push(args) };
    await field.selectLanguage("ar_001");
    assert.equal(messages.length, alive ? 1 : 0);
  }
});

test("language change refreshes the server session before the first page reload", async () => {
  const events = [];
  let resolveSession;
  const session = new Promise(resolve => { resolveSession = resolve; });
  const { PrintGatewayLanguageSwitcher } = await load("components/language_switcher.js", {}, {
    "@web/core/network/rpc": { rpc: async (route, params) => {
      assert.equal(route, "/web/session/get_session_info");
      assert.equal(Object.keys(params).length, 0);
      events.push("refresh-session");
      return session;
    } },
    "@web/core/user": { user: { lang: "en-US", userId: 4, updateContext: () => events.push("update-client") } },
    "@web/core/browser/browser": { browser: { location: { reload: () => events.push("reload") } } },
  });
  const field = Object.create(PrintGatewayLanguageSwitcher.prototype);
  field.alive = true;
  field.orm = { write: async () => events.push("write-language") };
  field.notification = { add() { assert.fail("successful switch must not show an error"); } };
  const pending = field.selectLanguage("ar_001");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ["write-language", "refresh-session"]);
  resolveSession({ user_context: { lang: "ar_001" } });
  await pending;
  assert.deepEqual(events, ["write-language", "refresh-session", "update-client", "reload"]);
});

test("an unavailable or stale language session never reloads with the previous layout", async () => {
  for (const reply of [null, { user_context: { lang: "en_US" } }]) {
    let reloaded = false;
    const messages = [];
    const { PrintGatewayLanguageSwitcher } = await load("components/language_switcher.js", {}, {
      "@web/core/network/rpc": { rpc: async () => { if (reply === null) throw new Error("session unavailable"); return reply; } },
      "@web/core/user": { user: { lang: "en-US", userId: 4, updateContext() {} } },
      "@web/core/browser/browser": { browser: { location: { reload: () => { reloaded = true; } } } },
    });
    const field = Object.create(PrintGatewayLanguageSwitcher.prototype);
    field.alive = true;
    field.orm = { write: async () => true };
    field.notification = { add: (...args) => messages.push(args) };
    await field.selectLanguage("ar_001");
    assert.equal(reloaded, false);
    assert.equal(messages.length, 1);
  }
});


test("printer inventory chooses an already assigned healthy agent without a second registration step", async () => {
  const { PrintersOverview } = await load("components/printers_overview.js");
  const view = Object.create(PrintersOverview.prototype);
  view.state = { scopes: [{ id: 21, companyId: 10, branchId: 21, configId: 2 }], scopeId: 21,
    agents: [], agentId: "", printers: [], loading: false, error: "" };
  view.alive = true;
  view.generation = 0;
  const called = [];
  view.call = async (route, args) => {
    called.push([route, args]);
    if (route === "/print_gateway/runtime-agents") return { agents: [
      { id: "agent-stale", status: "offline", freshness: "stale" },
      { id: "agent-ready", status: "online", freshness: "fresh" },
    ] };
    if (route === "/print_gateway/runtime-printers") return { printers: [{ id: "verified-printer" }] };
    throw new Error("unexpected RPC");
  };
  await view.refresh();
  assert.equal(view.state.agentId, "agent-ready");
  assert.deepEqual(Array.from(view.state.printers, p => p.id), ["verified-printer"]);
  assert.equal(called.length, 2);
  assert.deepEqual({ ...called[1][1] }, { company_id: 10, branch_id: 21, agent_id: "agent-ready" });
  assert.equal(view.hasMultipleScopes, false);
  assert.equal(view.showScopeSelector, false);
  view.state.scopeId = 0; // revoked explicit scope must offer a safe manual selector
  assert.equal(view.showScopeSelector, true);
  view.state.scopeId = 21;
  view.state.scopes.push({ id: 31, companyId: 30, branchId: false });
  assert.equal(view.hasMultipleScopes, true);
  assert.equal(view.showScopeSelector, true);
  // Inventory is read-only; changing the visible Agent never mutates assignments.
  assert.ok(called.every(([route]) => route === "/print_gateway/runtime-agents" || route === "/print_gateway/runtime-printers"));
});

test("Odoo Apps description uses translated manifest metadata, not untranslatable static HTML or repository links", () => {
  const base = path.resolve("odoo_addons/print_gateway");
  const manifest = fs.readFileSync(path.join(base, "__manifest__.py"), "utf8");
  const catalog = fs.readFileSync(path.join(base, "i18n/ar.po"), "utf8");
  const inventory = fs.readFileSync(path.join(base, "static/src/components/printers_overview.xml"), "utf8");
  const config = fs.readFileSync(path.join(base, "models/gateway_config.py"), "utf8");
  const menus = fs.readFileSync(path.join(base, "views/menu.xml"), "utf8");
  assert.equal(fs.existsSync(path.join(base, "static/description/index.html")), false);
  assert.doesNotMatch(manifest, /github\.com/);
  assert.match(manifest, /https:\/\/print\.yaseir\.cloud\//);
  assert.match(catalog, /model:ir\.module\.module,description:base\.module_print_gateway/);
  assert.match(catalog, /model:ir\.module\.module,summary:base\.module_print_gateway/);
  assert.match(inventory, /t-if="state\.agents\.length > 1"/);
  assert.match(inventory, /t-elif="state\.agents\.length === 1"/);
  assert.doesNotMatch(inventory, /o_pg_setup_steps/);
  assert.match(config, /context\["default_branch_id"\] = active_company\.id/);
  assert.match(menus, /name="Automatic Printing"/);
});

test("printer inventory explains unavailable agents without widening branch discovery", async () => {
  const { PrintersOverview } = await load("components/printers_overview.js");
  const view = Object.create(PrintersOverview.prototype);
  view.state = { scopes: [{ id: 21, companyId: 10, branchId: 21, configId: 2 }],
    scopeId: 21, agents: [], agentId: "", printers: [], loading: false, error: "", agentEmptyReason: "" };
  view.alive = true;
  view.generation = 0;
  for (const [reply, expected] of [
    [{ enabled: true, agents: [], assignedAgentCount: 0, registeredAgentCount: 2 }, "unassigned"],
    [{ enabled: true, agents: [], assignedAgentCount: 1, registeredAgentCount: 0 }, "not_registered"],
    [{ enabled: false, agents: [], assignedAgentCount: 0, registeredAgentCount: 0 }, "connection"],
    [{ enabled: true, agents: [] }, "unavailable"],
  ]) {
    let calls = 0;
    view.call = async (route, data) => {
      assert.equal(route, "/print_gateway/runtime-agents");
      assert.deepEqual({ company_id: data.company_id, branch_id: data.branch_id, assignment_only: data.assignment_only },
        { company_id: 10, branch_id: 21, assignment_only: true });
      calls += 1;
      return reply;
    };
    await view.refresh();
    assert.equal(calls, 1, "an unavailable scoped Agent cannot start printer discovery");
    assert.equal(view.state.agentEmptyReason, expected);
    assert.equal(view.state.printers.length, 0);
  }
});

test("printer inventory navigation maintains exact Odoo scope without creating assignments", async () => {
  const { PrintersOverview } = await load("components/printers_overview.js");
  const view = Object.create(PrintersOverview.prototype);
  view.state = { scopes: [{ id: 21, companyId: 10, branchId: 21, configId: 2,
    assignable: true }], scopeId: 21, agents: [], agentId: "", printers: [] };
  const actions = [];
  view.action = { doAction: action => { actions.push(action); return action; } };
  view.assignments();
  view.mappings();
  assert.deepEqual(actions.map(a => a.res_model),
    ["print_gateway.runtime_agent_assignment", "print_gateway.binding"]);
  assert.deepEqual(actions.map(a => ({ ...a.context })),
    [{ default_company_id: 10, default_branch_id: 21 },
     { default_company_id: 10, default_branch_id: 21 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(actions[0].domain)),
    [["company_id", "=", 10], ["branch_id", "=", 21]]);
  assert.deepEqual(JSON.parse(JSON.stringify(actions[1].domain)),
    [["company_id", "=", 10], ["branch_id", "in", [false, 21]]]);
  view.state.scopeId = 0;
  assert.equal(view.assignments(), undefined);
  assert.equal(view.mappings(), undefined);
  assert.equal(actions.length, 2, "a revoked scope never navigates to another branch");
});

test("scope labels never collapse equal-name companies into the same visible branch option", async () => {
  const { labelPrinterScopes } = await load("js/printer_scope_labels.js");
  const scopes = [
    { id: 5, name: "My Company", companyId: 5, branchId: false },
    { id: 6, name: "My Company", companyId: 6, branchId: false },
    { id: 7, name: "My Company", companyId: 7, branchId: false },
  ];
  const labeled = labelPrinterScopes(scopes, {
    company: "الشركة", branch: "الفرع", unavailable: "غير متاح",
  });
  assert.deepEqual(Array.from(labeled, row => row.id), [5, 6, 7]);
  assert.equal(new Set(Array.from(labeled, row => row.label)).size, 3);
  for (const row of labeled) {
    assert.match(row.label, new RegExp("#" + row.id));
    assert.ok(row.label.startsWith("الشركة: "));
  }
});
