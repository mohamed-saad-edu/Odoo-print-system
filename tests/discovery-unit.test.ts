import { describe, it, expect } from "vitest";
import { confidenceFor, DISCOVERY_SOURCES, validateDiscoveryRequest } from "../src/lib/discovery";



describe("discovery taxonomy", () => {
  it("canonical sources include all required", () => {
    expect(DISCOVERY_SOURCES).toContain("mdns");
    expect(DISCOVERY_SOURCES).toContain("snmp");
    expect(DISCOVERY_SOURCES).toContain("wsd");
    expect(DISCOVERY_SOURCES).toContain("windows_spooler");
    expect(DISCOVERY_SOURCES).toContain("usb");
    expect((DISCOVERY_SOURCES as readonly string[]).includes("pcl")).toBe(false);
  });
});

describe("discovery request scope", () => {
  it("rejects caller-supplied CIDR and protocol scope", () => {
    expect(validateDiscoveryRequest({ cidr: "8.8.8.0/24", protocols: ["ipp"] }).ok).toBe(false);
  });
});

describe("confidence scoring deterministic", () => {
  it("high when verified IPP + model", () => {
    expect(confidenceFor(["ipp","mdns"], "verified", true)).toBe("high");
  });
  it("medium when candidate but model present", () => {
    expect(confidenceFor(["raw"], "candidate", true)).toBe("medium");
  });
  it("low when single low-signal candidate", () => {
    expect(confidenceFor(["raw"], "candidate", false)).toBe("low");
  });
  it("deterministic: same inputs same output", () => {
    const a = confidenceFor(["ipp","snmp"], "verified", true);
    const b = confidenceFor(["ipp","snmp"], "verified", true);
    expect(a).toBe(b);
  });
});
