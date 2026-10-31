import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatRelativeTime } from "../src/i18n/format";
import { formatManualCalendarDate } from "../src/lib/manual-calendar-date";

describe("locale date input normalization", () => {
  it("keeps Arabic Latin-digit dates in day/month/year order inside LTR fields", () => {
    const value = "2026-11-30T12:34:00Z";
    expect(formatDate(value, "ar")).toBe("30/11/2026");
    expect(formatDateTime(value, "ar")).toContain("30/11/2026");
    expect(formatManualCalendarDate(value, "ar")).toBe("30/11/2026");
  });
  it.each(["en", "ar"] as const)("preserves ISO date-only forms in %s", (locale) => {
    for (const [input, instant] of [
      ["2026", "2026-01-01T00:00:00Z"],
      ["2026-10", "2026-10-01T00:00:00Z"],
      ["2026-10-15", "2026-10-15T00:00:00Z"],
    ]) {
      const expected = new Date(instant);
      expect(formatDate(input, locale)).toBe(formatDate(expected, locale));
      expect(formatDateTime(input, locale)).toBe(formatDateTime(expected, locale));
      expect(formatRelativeTime(input, locale, expected.getTime() + 3600_000))
        .toBe(formatRelativeTime(expected, locale, expected.getTime() + 3600_000));
    }
  });

  it.each(["2026-10-15 12:34:56", "2026-10-15 14:34:56+02", "2026-10-15T14:34:56+02:00"])("retains UTC/offset timestamp handling for %s", (input) => {
    expect(formatDateTime(input, "en")).toBe(formatDateTime(new Date("2026-10-15T12:34:56Z"), "en"));
  });

  it("keeps malformed or missing values unavailable", () => {
    expect(formatDate("not-a-date", "en")).toBe(formatDate(null, "en"));
    expect(formatDateTime("", "ar")).toBe(formatDateTime(null, "ar"));
  });
});
