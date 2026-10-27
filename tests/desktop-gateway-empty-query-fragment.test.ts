import { describe, expect, it } from "vitest";
import { normalizeGatewayUrl } from "../src/desktop/lib/ipc";

/**
 * The native Rust and Go gateways reject even an empty query/fragment marker.
 * The browser URL API exposes empty ?/# as search === "" / hash === "", so
 * renderer validation must inspect their presence, not only their value.
 */
describe("Desktop Gateway origin matches native Rust/Go URL boundary", () => {
  it.each([
    "https://gateway.example.com/?",
    "https://gateway.example.com?",
    "https://gateway.example.com/#",
    "https://gateway.example.com#",
    "https://gateway.example.com/?#",
    "http://localhost:3000/?",
    "http://localhost:3000/#",
  ])("rejects an empty query or fragment marker (%s)", (input) => {
    expect(() => normalizeGatewayUrl(input))
      .toThrow("Gateway URL cannot include query strings or fragments");
  });

  it.each([
    ["gateway.example.com", "https://gateway.example.com"],
    ["https://gateway.example.com/", "https://gateway.example.com"],
    ["http://localhost:3000/", "http://localhost:3000"],
  ])("continues accepting native-supported root origins (%s)", (raw, expected) => {
    expect(normalizeGatewayUrl(raw)).toBe(expected);
  });

  it.each([
    "https://@gateway.example.com/",
    "https://:@gateway.example.com/",
    "https://user:@gateway.example.com/",
  ])("rejects any raw userinfo marker, including empty credentials (%s)", (input) => {
    expect(() => normalizeGatewayUrl(input))
      .toThrow("Gateway URL cannot include embedded credentials");
  });

  it("continues to reject remote HTTP and nonroot paths before pairing", () => {
    expect(() => normalizeGatewayUrl("http://gateway.example.com"))
      .toThrow("Gateway URL must use HTTPS for remote Gateways");
    expect(() => normalizeGatewayUrl("https://gateway.example.com/base"))
      .toThrow("Gateway URL must use the origin root");
  });
});
