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
    "@odoo/owl": { Component: class {}, onWillUnmount() {}, onMounted() {}, useEffect() {}, useState: v => v, xml: () => "" },
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
