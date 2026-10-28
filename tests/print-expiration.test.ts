import { describe, expect, it } from "vitest";
import { parsePrintExpiration } from "../src/lib/print-expiration";

describe("Odoo print expiration wire contract", () => {
  it("uses the database-service default only when expiresAt is omitted", () => {
    expect(parsePrintExpiration(undefined)).toBeUndefined();
  });

  it("normalizes explicit UTC and numeric offsets to the same instant", () => {
    expect(parsePrintExpiration("2028-02-29T09:30:00.000Z")?.toISOString()).toBe("2028-02-29T09:30:00.000Z");
    expect(parsePrintExpiration("2028-02-29T12:30:00+03:00")?.toISOString()).toBe("2028-02-29T09:30:00.000Z");
  });

  it.each(["", " ", "tomorrow", "2026-10-28", "2026-10-28T12:00:00", "2026-02-30T10:00:00.000Z", "2026-13-01T00:00:00Z"])(
    "rejects explicit malformed expiry %j instead of extending the job",
    value => {
      expect(() => parsePrintExpiration(value)).toThrow(/expiresAt must be/);
    },
  );
});
