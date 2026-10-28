import { describe, expect, it } from "vitest";
import { aliasPrinterIdForAgent } from "../src/lib/printer-identity";

describe("agent-scoped printer alias identity", () => {
  it("is deterministic per agent and local id", () => {
    expect(aliasPrinterIdForAgent("printer_net_deadbeef", "agt_aaaaaaaa")).toBe(
      aliasPrinterIdForAgent("printer_net_deadbeef", "agt_aaaaaaaa"),
    );
  });

  it("scopes the same local id distinctly per agent", () => {
    const a = aliasPrinterIdForAgent("printer_net_deadbeef", "agt_aaaaaaaa");
    const b = aliasPrinterIdForAgent("printer_net_deadbeef", "agt_bbbbbbbb");
    expect(a).not.toBe(b);
    expect(a.startsWith("printer_net_deadbeef~")).toBe(true);
    expect(b.startsWith("printer_net_deadbeef~")).toBe(true);
  });

  it("uses the tilde sentinel with an 8-hex suffix the agent strips", () => {
    const alias = aliasPrinterIdForAgent("printer_usb_1234abcd", "agt_aaaaaaaa");
    expect(alias).toMatch(/^printer_usb_1234abcd~[0-9a-f]{8}$/);
    expect(Buffer.byteLength(alias, "utf8")).toBeLessThanOrEqual(120);
  });

  it("keeps long and multibyte local IDs within Gateway heartbeat bounds without losing agent scoping", () => {
    for (const id of ["x".repeat(120), "é".repeat(60), "a".repeat(110) + "📦📦📦"]) {
      const result = aliasPrinterIdForAgent(id, "agt_aaaaaaaa");
      expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(120);
      expect(result).toMatch(/~[0-9a-f]{8}$/);
      expect(result).not.toContain("\uFFFD");
      expect(result).not.toBe(aliasPrinterIdForAgent(id, "agt_bbbbbbbb"));
      expect(result).toBe(aliasPrinterIdForAgent(id, "agt_aaaaaaaa"));
    }
  });
});
