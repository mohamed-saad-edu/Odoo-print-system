import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve("odoo_addons/print_gateway/static/src");
const now = Date.parse("2026-10-24T13:30:00Z");
class Clock extends Date { static now() { return now; } }
async function load(relative) {
  const registry = { category: () => ({ add() {}, contains: () => false }) };
  const stubs = {
    "@odoo/owl": { Component: class {}, onWillUnmount() {}, useEffect() {}, useState: v => v, xml: () => "" },
    "@web/core/registry": { registry }, "@web/core/network/rpc": { rpc() {} },
    "@web/core/l10n/translation": { _t: value => value },
  };
  const context = vm.createContext({ console, setTimeout, clearTimeout, Date: Clock });
  const modules = new Map();
  async function moduleFor(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const mod = new vm.SourceTextModule(fs.readFileSync(filename, "utf8"), { context, identifier: filename });
    modules.set(filename, mod);
    await mod.link(async (id, importing) => {
      if (stubs[id]) return new vm.SyntheticModule(Object.keys(stubs[id]), function () {
        for (const [key, value] of Object.entries(stubs[id])) this.setExport(key, value);
      }, { context });
      assert(id.startsWith("."));
      return moduleFor(path.resolve(path.dirname(importing.identifier), `${id}.js`));
    });
    return mod;
  }
  const entry = await moduleFor(path.join(root, relative));
  await entry.evaluate();
  return entry.namespace;
}

function printer(id = "file-a", file = true) {
  const stamp = new Date(now).toISOString();
  return { id, connectionType: file ? "pdf_output" : "spooler", protocol: file ? "pdf" : "spooler",
    printerType: file ? "file" : "physical", deviceClass: "laser", outputMedium: file ? "file" : "physical",
    verificationState: "verified", verificationVerifiedAt: stamp, verificationReceivedAt: stamp,
    capabilities: { supported_protocols: ["pdf", "image"],
      operational_verification: { version: 1, verified_at: stamp, printer_id: id,
        binding_digest: "a".repeat(64), logical_queue_key: "a".repeat(64),
        method: file ? "pdf_output" : "windows_queue", identity_strength: file ? "service" : "queue", output_medium: file ? "file" : "physical" },
      geometry: { version: 1, source: "validated_profile", validation: "configured", observed_at: stamp,
        printer_id: id, config_fingerprint: "b".repeat(64), paper_width_mm: 210, paper_height_mm: 297,
        printable_width_dots: 2244, printable_height_dots: 3271, offset_x_dots: 118, offset_y_dots: 118,
        dpi_x: 300, dpi_y: 300 } } };
}

async function field(printers) {
  const { RuntimePrinterField } = await load("components/runtime_printer_field.js");
  const result = Object.create(RuntimePrinterField.prototype);
  result.props = { name: "printer_id", record: { data: {}, fields: { printer_protocol: true }, update: () => {} } };
  result.state = { destinationType: "pos", printers };
  return result;
}

test("approved PDF output and ordinary office driver remain selectable for receipts and kitchen", async () => {
  const instance = await field([printer(), printer("office", false)]);
  for (const destination of ["pos", "pos_printer", "report"]) {
    instance.state.destinationType = destination;
    assert.deepEqual(Array.from(instance.filteredPrinters, p => p.id), ["file-a", "office"]);
  }
});

test("cached verification expires before selection and cannot be rescued by online status", async () => {
  const expired = printer("expired", false);
  expired.verificationReceivedAt = new Date(now - 300001).toISOString();
  expired.status = "online";
  const instance = await field([expired, printer()]);
  assert.deepEqual(Array.from(instance.filteredPrinters, p => p.id), ["file-a"]);
  let changes = 0, refreshes = 0;
  instance.props.record.update = () => { changes += 1; };
  instance.retryLoad = () => { refreshes += 1; };
  instance.onChange({ target: { value: "expired" } });
  assert.equal(changes, 0);
  assert.equal(refreshes, 1);
});

test("file output selection records the pdf protocol", async () => {
  const instance = await field([printer()]);
  let change;
  instance.props.record.update = value => { change = value; };
  instance.onChange({ target: { value: "file-a" } });
  assert.equal(change.printer_protocol, "pdf");
});

test("unknown file page boundaries, unverified endpoints and raw IPP image are excluded", async () => {
  const incomplete = printer("missing-height");
  delete incomplete.capabilities.geometry.paper_height_mm;
  const pending = printer("pending"); pending.verificationState = "pending";
  const wrong = printer("wrong-proof"); wrong.capabilities.operational_verification.printer_id = "elsewhere";
  const ipp = printer("ipp", false); ipp.connectionType = ipp.protocol = "ipp";
  ipp.capabilities.operational_verification.method = "ipp_attributes";
  ipp.capabilities.operational_verification.identity_strength = "service";
  const instance = await field([incomplete, pending, wrong, ipp]);
  assert.deepEqual(Array.from(instance.filteredPrinters, p => p.id), []);
});

const fixtures = JSON.parse(fs.readFileSync("contracts/printer-operational-verification-fixtures.json", "utf8"));
for (const entry of fixtures.proofCases) {
  test(`operational reader matches shared Gateway/Agent vector: ${entry.name}`, async () => {
    const { validatedOperationalVerification } = await load("js/printer_verification.js");
    assert.equal(Boolean(validatedOperationalVerification(entry.proof, entry.printer, Date.parse(fixtures.now))), entry.valid);
  });
}
