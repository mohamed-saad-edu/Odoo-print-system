import { describe, expect, it } from "vitest";
import { isPrinterAvailableForJob, isPrinterClaimable } from "../src/lib/routing";
import { physicalPrinterIdentityKey } from "../src/lib/physical-printer-identity";

const pending = { id: "printer-queue-a", lifecycle: "active", status: "online", inventoryPresent: true,
  sharedWithGateway: true, name: "Office queue", printerType: "physical", connectionType: "spooler", protocol: "spooler",
  config: { spooler_name: "Office queue" }, capabilities: null };

describe("operational proof is independent of configured geometry or online status", () => {
  // Policy (operator directive): operational verification is background
  // evidence, never an availability or claim gate. A named, online queue
  // is available and claimable without any current Agent proof; only real
  // errors (offline/error status, retired/absent/unshared printer) block.
  // These two tests replace the former hard-gate expectations.
  it("makes a named, online queue available without current Agent proof", () => {
    expect(isPrinterAvailableForJob(pending)).toBe(true);
  });
  it("claims an unverified target whose transport is declared", () => {
    expect(isPrinterClaimable({ ...pending, status: "unknown" })).toBe(true);
  });
  it("still blocks real errors without any proof involvement", () => {
    expect(isPrinterClaimable({ ...pending, status: "offline" })).toBe(false);
    expect(isPrinterAvailableForJob({ ...pending, status: "offline" })).toBe(false);
    expect(isPrinterAvailableForJob({ ...pending, inventoryPresent: false })).toBe(false);
    expect(isPrinterAvailableForJob({ ...pending, lifecycle: "disabled" })).toBe(false);
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
import { isVirtualPrinterRecord } from "../src/lib/printer-virtual";

describe("canonical operational proof fixtures", () => {
  for (const entry of fixtures.proofCases) it(entry.name, () => {
    expect(validatePrinterOperationalVerification(entry.proof, entry.printer, new Date(fixtures.now)).ok).toBe(entry.valid);
  });
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
      // Persisted legacy verified state cannot bypass the current ID contract
      // just because a prior Agent recorded current timestamps and a digest.
      const known = { ...first.printer,
        ...operationalVerificationProjection(first.proof, first.printer, new Date(fixtures.now)),
        id,
      };
      expect(isPrinterOperationallyVerified(known, new Date(fixtures.now)), name + " persisted proof").toBe(allowed);
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
  it("detects virtual Windows queues by name while real queues stay physical", () => {
    expect(isVirtualPrinterRecord({ name: "Microsoft Print to PDF", printerType: "physical", connectionType: "spooler", protocol: "spooler" })).toBe(true);
    expect(isVirtualPrinterRecord({ name: "Office Queue", printerType: "physical", connectionType: "spooler", protocol: "spooler" })).toBe(false);
  });
});
