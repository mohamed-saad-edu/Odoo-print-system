import { describe, expect, it, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { AGENT_ID_PATTERN, generatePairingCode, hashPairingCode, isValidAgentId, isValidPairingCode, PAIRING_CODE_PATTERN } from "../src/lib/agent-auth";

describe("pairing code contract", () => {
  it("generates 1000 codes accepted by the registration contract", () => {
    const codes = Array.from({ length: 1000 }, () => generatePairingCode());
    expect(codes.every((code) => PAIRING_CODE_PATTERN.test(code))).toBe(true);
    expect(codes.every((code) => code.length === 6)).toBe(true);
  });

  it("uses the unambiguous alphabet shared by Gateway, Go and Tauri", () => {
    expect(isValidPairingCode("AB22CD")).toBe(true);
    expect(isValidPairingCode("ab22cd")).toBe(true);
    expect(isValidPairingCode("123456")).toBe(false);
    expect(isValidPairingCode("AB01CD")).toBe(false);
    expect(isValidPairingCode("ABIOCD")).toBe(false);
    expect(isValidPairingCode("ABCDE")).toBe(false);
    expect(isValidPairingCode("ABCDEFG")).toBe(false);
  });

  it("deterministically hashes normalized pairing codes with sha256", () => {
    const code = "AB22CD";
    const h1 = hashPairingCode(code);
    const h2 = hashPairingCode("ab22cd");
    const h3 = hashPairingCode("  ab22cd  ");
    expect(h1).toBe(h2);
    expect(h1).toBe(h3);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
    expect(h1).not.toBe(code);
  });

  it("peppers the pairing code hash so a leaked database row cannot be reversed", () => {
    const previous = process.env.GATEWAY_JWT_SECRET;
    process.env.GATEWAY_JWT_SECRET = "a".repeat(48);
    try {
      const peppered = hashPairingCode("AB22CD");
      const plainSha256 = createHash("sha256").update("AB22CD").digest("hex");
      // A database leak must not hand the attacker a reversible hash of a
      // 30-bit credential.
      expect(peppered).not.toBe(plainSha256);
      expect(peppered).toMatch(/^[a-f0-9]{64}$/);
      // Still deterministic, so registration can look the code up by hash.
      expect(peppered).toBe(hashPairingCode("ab22cd"));
    } finally {
      if (previous === undefined) delete process.env.GATEWAY_JWT_SECRET;
      else process.env.GATEWAY_JWT_SECRET = previous;
    }
  });

  it("falls back to the plain hash when no server secret is configured", () => {
    const previous = process.env.GATEWAY_JWT_SECRET;
    delete process.env.GATEWAY_JWT_SECRET;
    try {
      expect(hashPairingCode("AB22CD")).toBe(createHash("sha256").update("AB22CD").digest("hex"));
    } finally {
      if (previous !== undefined) process.env.GATEWAY_JWT_SECRET = previous;
    }
  });
});


describe("agent ID contract", () => {
  it("accepts canonical Gateway agent IDs", () => {
    expect(AGENT_ID_PATTERN.test("agt_scZ7zHZ5")).toBe(true);
    expect(isValidAgentId("agt_scZ7zHZ5")).toBe(true);
  });

  it("rejects UUID and malformed agent IDs", () => {
    expect(isValidAgentId("550e8400-e29b-41d4-a716-446655440000")).toBe(false);
    expect(isValidAgentId("agent_scZ7zHZ5")).toBe(false);
    expect(isValidAgentId("agt_short")).toBe(false);
    expect(isValidAgentId("agt_1234567")).toBe(false);
  });
});
