import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { physicalPrinterIdentityKey as key, matchingPhysicalPrinter, samePrinterProtocol } from "../src/lib/physical-printer-identity";

describe("physical printer identity", () => {
  it("converges the same Windows queue across outer whitespace/case while preserving internal spaces", () => {
    const a = { connectionType: "spooler", protocol: "spooler", config: { spooler_name: " ZEBRA ZD421 " } };
    expect(key(a)).toBe(key({ ...a, config: { address: "zebra zd421" } }));
    expect(key(a)).not.toBe(key({ ...a, config: { address: "zebra zd421 B" } }));
    expect(key(a)).not.toBe(key({ ...a, config: { address: "zebra  zd421" } }));
  });
  it("protects one network endpoint even across print-language variants", () => {
    const a = { connectionType: "network", protocol: "raw", config: { ip: "PRINTER.LOCAL.", port: 9100 } };
    const b = { ...a, protocol: "escpos", config: { ip: "printer.local", port: 9100 } };
    expect(key(a)).toBe(key(b));
    expect(samePrinterProtocol(a,b)).toBe(false);
    expect(key(a)).not.toBe(key({ ...a, config: { ip: "printer.local", port: 9101 } }));
  });
  it("matches equivalent IPv6 destinations without changing existing printer IDs", () => {
    const registered = { id: "persisted-printer", connectionType: "network", protocol: "raw",
      config: { ip: "fd00:0:0:0:0:0:0:1", port: 9100 } };
    const observed = { ...registered, id: "new-observation", config: { ip: "[fd00::1]", port: 9100 } };
    expect(key(registered)).toBe(key(observed));
    expect(matchingPhysicalPrinter([registered], observed)?.id).toBe("persisted-printer");
    expect(key(registered)).not.toBe(key({ ...observed, config: { ip: "fd00::2", port: 9100 } }));
  });
  it("distinguishes IPP resource paths and security schemes", () => {
    const a = { connectionType: "ipp", protocol: "ipp", config: { address: "ipp://PrintServer.local:631/printers/one" } };
    expect(key(a)).toBe(key({ ...a, config: { address: "ipp://printserver.local/printers/one" } }));
    expect(key(a)).not.toBe(key({ ...a, config: { address: "ipp://printserver.local/printers/two" } }));
    expect(key(a)).not.toBe(key({ connectionType: "ipps", protocol: "ipps", config: { address: "ipps://printserver.local/printers/one" } }));
  });

  it("keeps native network IPPS observations distinct from insecure IPP and matches explicit TLS URI", () => {
    const insecure = { connectionType: "network", protocol: "ipp", config: { ip: "PRINT.LOCAL.", port: 631 } };
    const secure = { ...insecure, protocol: "ipps" };
    const explicit = { connectionType: "ipps", protocol: "ipps",
      config: { address: "ipps://print.local:631/ipp/print" } };
    expect(key(secure)).not.toBeNull();
    expect(key(secure)).toBe(key(explicit));
    expect(key(secure)).not.toBe(key(insecure));
    // A duplicate-resolution lookup must never reuse a plaintext queue for a TLS queue.
    expect(matchingPhysicalPrinter([{ id: "plaintext", ...insecure }], secure)).toBeUndefined();
    expect(matchingPhysicalPrinter([{ id: "tls", ...explicit }], secure)?.id).toBe("tls");
  });

  it("does not dedupe an empty-userinfo IPP URL onto a valid physical queue", () => {
    const safe = { connectionType: "ipp", protocol: "ipp", config: { address: "ipp://192.168.1.60:631/ipp/print" } };
    const malformed = { ...safe, config: { address: "ipp://@192.168.1.60:631/ipp/print" } };
    expect(key(safe)).toMatch(/^v2:[a-f0-9]{64}$/);
    expect(key(malformed)).toBeNull();
    expect(matchingPhysicalPrinter([{ id: "queue", ...safe }], malformed)).toBeUndefined();
  });

  it("never merges an explicit IPP root with the different /ipp/print queue", () => {
    const root = { connectionType: "ipp", protocol: "ipp", config: { address: "ipp://printserver.local/" } };
    const noPath = { ...root, config: { address: "ipp://printserver.local" } };
    const defaultQueue = { ...root, config: { address: "ipp://printserver.local/ipp/print" } };
    const scannedDefault = { connectionType: "network", protocol: "ipp", config: { ip: "printserver.local", port: 631 } };
    // Omitting a URI path still addresses the HTTP request root.
    expect(key(noPath)).toBe(key(root));
    expect(key(noPath)).not.toBe(key(defaultQueue));
    // The TCP scanner explicitly observes /ipp/print, which may be another queue.
    expect(key(scannedDefault)).toBe(key(defaultQueue));
    expect(matchingPhysicalPrinter([{ id: "default-queue", ...defaultQueue }], root)).toBeUndefined();
    expect(matchingPhysicalPrinter([{ id: "root-queue", ...root }], noPath)?.id).toBe("root-queue");
  });

  it("scheme-less IPP host shortcut matches its explicit print resource, never the root queue", () => {
    const shortcut = { connectionType: "ipp", protocol: "ipp", config: { address: "192.168.1.20:631" } };
    const defaultQueue = { connectionType: "ipp", protocol: "ipp", config: { address: "ipp://192.168.1.20/ipp/print" } };
    const root = { connectionType: "ipp", protocol: "ipp", config: { address: "ipp://192.168.1.20/" } };
    expect(key(shortcut)).toBe(key(defaultQueue));
    expect(key(shortcut)).not.toBe(key(root));
    expect(matchingPhysicalPrinter([{ id: "canonical", ...defaultQueue }], shortcut)?.id).toBe("canonical");
    // A bare host with a path is not a valid native execution shortcut.
    expect(key({ ...shortcut, config: { address: "192.168.1.20:631/printers/office" } })).toBeNull();
  });


  it("does not collapse USB devices merely by model", () => {
    expect(key({ connectionType: "usb", protocol: "unknown", config: { vid: 100, pid: 200 } })).toBe(null);
    expect(key({ connectionType: "usb", protocol: "unknown", config: { vid: 100, pid: 200, serial: "a" } }))
      .not.toBe(key({ connectionType: "usb", protocol: "unknown", config: { vid: 100, pid: 200, serial: "b" } }));
  });
  it("never reuses a stale database identity key when the stored endpoint is incomplete or malformed", () => {
    const incoming = { connectionType: "network", protocol: "raw", config: { ip: "10.20.30.40", port: 9100 } };
    const staleKey = key(incoming);
    const malformed = { id: "stale", connectionType: "network", protocol: "raw",
      config: { ip: "10.20.30.99", port: "9100" }, physicalIdentityKey: staleKey };
    const missing = { id: "missing", connectionType: "network", protocol: "raw",
      config: {}, physicalIdentityKey: staleKey };
    expect(matchingPhysicalPrinter([malformed, missing], incoming)).toBeUndefined();
    // Existing old rows with a valid endpoint still converge from live config.
    expect(matchingPhysicalPrinter([{ ...malformed, config: incoming.config }], incoming)?.id).toBe("stale");
  });

  it("keeps the heartbeat discovery deduplication aligned with live endpoint identity", () => {
    const source = readFileSync("src/app/api/agent/heartbeat/route.ts", "utf8");
    expect(source).toContain("const endpoint = physicalPrinterIdentityKey(row);");
    expect(source).not.toContain("physicalPrinterIdentityKey(row) ?? row.physicalIdentityKey");
  });

  it("compares legacy keyless rows without deleting historical printer identities", () => {
    const input = { connectionType: "network", protocol: "raw", config: { ip: "192.168.1.100", port: 9100 } };
    expect(matchingPhysicalPrinter([{ id: "legacy", physicalIdentityKey: null, ...input }], input)?.id).toBe("legacy");
  });
});
