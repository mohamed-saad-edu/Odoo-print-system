import { describe, expect, it } from "vitest";
import { physicalPrinterIdentityKey as key, matchingPhysicalPrinter, samePrinterProtocol } from "../src/lib/physical-printer-identity";

describe("physical printer identity", () => {
  it("converges the same Windows queue regardless of cosmetic spelling", () => {
    const a = { connectionType: "spooler", protocol: "spooler", config: { spooler_name: " ZEBRA ZD421 " } };
    expect(key(a)).toBe(key({ ...a, config: { address: "zebra  zd421" } }));
    expect(key(a)).not.toBe(key({ ...a, config: { address: "zebra zd421 B" } }));
  });
  it("protects one network endpoint even across print-language variants", () => {
    const a = { connectionType: "network", protocol: "raw", config: { ip: "PRINTER.LOCAL.", port: 9100 } };
    const b = { ...a, protocol: "escpos", config: { ip: "printer.local", port: 9100 } };
    expect(key(a)).toBe(key(b));
    expect(samePrinterProtocol(a,b)).toBe(false);
    expect(key(a)).not.toBe(key({ ...a, config: { ip: "printer.local", port: 9101 } }));
  });
  it("distinguishes IPP resource paths and security schemes", () => {
    const a = { connectionType: "ipp", protocol: "ipp", config: { address: "ipp://PrintServer.local:631/printers/one" } };
    expect(key(a)).toBe(key({ ...a, config: { address: "ipp://printserver.local/printers/one" } }));
    expect(key(a)).not.toBe(key({ ...a, config: { address: "ipp://printserver.local/printers/two" } }));
    expect(key(a)).not.toBe(key({ connectionType: "ipps", protocol: "ipps", config: { address: "ipps://printserver.local/printers/one" } }));
  });
  it("does not collapse USB devices merely by model", () => {
    expect(key({ connectionType: "usb", protocol: "unknown", config: { vid: 100, pid: 200 } })).toBe(null);
    expect(key({ connectionType: "usb", protocol: "unknown", config: { vid: 100, pid: 200, serial: "a" } }))
      .not.toBe(key({ connectionType: "usb", protocol: "unknown", config: { vid: 100, pid: 200, serial: "b" } }));
  });
  it("compares legacy keyless rows without deleting historical printer identities", () => {
    const input = { connectionType: "network", protocol: "raw", config: { ip: "192.168.1.100", port: 9100 } };
    expect(matchingPhysicalPrinter([{ id: "legacy", physicalIdentityKey: null, ...input }], input)?.id).toBe("legacy");
  });
});
