import { describe, expect, it } from "vitest";
import { isPrinterAvailableForJob, isPrinterClaimable } from "../src/lib/routing";
import { physicalPrinterIdentityKey } from "../src/lib/physical-printer-identity";

const pending = { id: "printer-queue-a", lifecycle: "active", status: "online", inventoryPresent: true,
  sharedWithGateway: true, name: "Office queue", printerType: "physical", connectionType: "spooler", protocol: "spooler",
  config: { spooler_name: "Office queue" }, capabilities: null };

describe("operational proof is independent of configured geometry or online status", () => {
  it("does not make a named, online queue available without current Agent proof", () => {
    expect(isPrinterAvailableForJob(pending)).toBe(false);
  });
  it("does not claim an unverified target merely because its transport is declared", () => {
    expect(isPrinterClaimable({ ...pending, status: "unknown" })).toBe(false);
  });
  it("retains two distinct Windows queues whose names differ by internal whitespace", () => {
    const first = physicalPrinterIdentityKey({ ...pending, config: { spooler_name: "Office  queue" } });
    const second = physicalPrinterIdentityKey({ ...pending, config: { spooler_name: "Office queue" } });
    expect(first).not.toBe(second);
  });
  it("treats IPPS implicit port as 631, preserving the exact service resource", () => {
    const first = physicalPrinterIdentityKey({ connectionType: "ipps", protocol: "ipps", config: { address: "ipps://192.168.1.50/ipp/print" } });
    const second = physicalPrinterIdentityKey({ connectionType: "ipps", protocol: "ipps", config: { address: "ipps://192.168.1.50:631/ipp/print" } });
    expect(first).toBe(second);
  });
});

import fixtures from "../contracts/printer-operational-verification-fixtures.json";
import { validatePrinterOperationalVerification, isPrinterOperationallyVerified, operationalVerificationProjection } from "../src/lib/printer-operational-verification";
import { validateFileOutputEvidence } from "../src/lib/print-output";
import { parsePrinterInput } from "../src/lib/printer-model";
import { validatePayloadForPrinter } from "../src/lib/printer-capability";
import { isVirtualPrinterRecord } from "../src/lib/printer-virtual";

describe("canonical operational proof and file-result fixtures", () => {
  for (const entry of fixtures.proofCases) it(entry.name, () => {
    expect(validatePrinterOperationalVerification(entry.proof, entry.printer, new Date(fixtures.now)).ok).toBe(entry.valid);
  });
  for (const entry of fixtures.fileOutputCases) it(entry.name, () => expect(Boolean(validateFileOutputEvidence(entry.evidence))).toBe(entry.valid));
  it("rejects apparently matching but wire-invalid printer identities before marking proof verified", () => {
    const first = fixtures.proofCases[0];
    if (!first.proof) throw new Error("missing canonical Windows queue proof fixture");
    const cases: Array<[string, string, boolean]> = [
      ["120-byte Arabic", "ط".repeat(60), true],
      ["122-byte Arabic", "ط".repeat(61), false],
      ["120-byte emoji", "🖨".repeat(30), true],
      ["124-byte emoji", "🖨".repeat(31), false],
      ["leading BOM", "\uFEFFqueue", false],
      ["isolated surrogate", "\uD800", false],
      ["interior BOM is exact", "que\uFEFFue", true],
    ];
    for (const [name, id, allowed] of cases) {
      // A proof can match the database row byte-for-byte and still contain
      // a printer ID the Agent/Gateway inventory protocol cannot encode.
      const owner = { id, connectionType: "spooler", protocol: "spooler" };
      const proof = { ...first.proof, printer_id: id };
      expect(validatePrinterOperationalVerification(proof, owner, new Date(fixtures.now)).ok, name).toBe(allowed);
      expect(operationalVerificationProjection(proof, owner, new Date(fixtures.now)).verificationState, name)
        .toBe(allowed ? "verified" : "pending");
    }
  });

  it("requires both server receipt and source timestamps; refreshing only a receipt cannot renew proof", () => {
    const now = new Date(fixtures.now), entry = fixtures.proofCases[0];
    const current = { ...entry.printer, ...operationalVerificationProjection(entry.proof, entry.printer, now) };
    expect(isPrinterOperationallyVerified(current, now)).toBe(true);
    expect(isPrinterOperationallyVerified({ ...current, verificationReceivedAt: null }, now)).toBe(false);
    expect(isPrinterOperationallyVerified({ ...current, verificationVerifiedAt: new Date(now.getTime() - 301000) }, now)).toBe(false);
    expect(isPrinterOperationallyVerified({ ...current, verificationReceivedAt: new Date(now.getTime() - 301000) }, now)).toBe(false);
    expect(isPrinterOperationallyVerified({ ...current, managementSource: "manager", desiredRevision: 2, appliedDesiredRevision: 1, observedDesiredRevision: 1 }, now)).toBe(false);
  });
  it("limits the file backend to an opaque approved profile and truthful output type", () => {
    const configured = { agentId: "agent-a", name: "Office PDF archive", printerType: "file", connectionType: "pdf_output", protocol: "pdf", config: { output_profile_id: "approved_archive" } };
    expect(parsePrinterInput(configured).config.output_profile_id).toBe("approved_archive");
    for (const patch of [{ config: { output_profile_id: "valid\n" } }, { config: { output_profile_id: "../escape" } }, { config: { output_profile_id: "approved_archive", directory: "/tmp" } }, { printerType: "physical" }, { protocol: "spooler" }]) expect(() => parsePrinterInput({ ...configured, ...patch })).toThrow();
    expect(isVirtualPrinterRecord(configured)).toBe(false);
    expect(isVirtualPrinterRecord({ name: "Microsoft Print to PDF", printerType: "physical", connectionType: "spooler", protocol: "spooler" })).toBe(true);
  });
  it("admits ordinary PDFs but requires full explicit page geometry for file images", () => {
    const printer = { id: "pdf-file", connectionType: "pdf_output", protocol: "pdf", capabilities: null };
    expect(validatePayloadForPrinter({ type: "pdf" }, printer).ok).toBe(true);
    expect(validatePayloadForPrinter({ type: "raw", protocol: "raw" }, printer).ok).toBe(false);
    expect(validatePayloadForPrinter({ type: "image", geometry_fingerprint: digestForImage }, printer).ok).toBe(false);
    const measured = { ...printer, config: { geometry_profile: {
      printable_width_dots: 2400, printable_height_dots: 3400, dpi_x: 300, dpi_y: 300,
      paper_width_mm: 210, paper_height_mm: 297, offset_x_dots: 40, offset_y_dots: 40,
    } }, capabilities: { geometry: { version: 1, source: "validated_profile", validation: "configured", observed_at: fixtures.now,
      printer_id: printer.id, config_fingerprint: digestForImage, printable_width_dots: 2400, printable_height_dots: 3400,
      dpi_x: 300, dpi_y: 300, paper_width_mm: 210, paper_height_mm: 297, offset_x_dots: 40, offset_y_dots: 40 } } };
    expect(validatePayloadForPrinter({ type: "image", geometry_fingerprint: digestForImage }, measured).ok).toBe(true);
    const { offset_y_dots: _missing, ...withoutMargin } = measured.capabilities.geometry;
    expect(validatePayloadForPrinter({ type: "image", geometry_fingerprint: digestForImage }, { ...measured, capabilities: { geometry: withoutMargin } }).ok).toBe(false);
  });
});
const digestForImage = "f".repeat(64);
