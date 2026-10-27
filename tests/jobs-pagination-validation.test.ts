import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseStrictListOffset } from "../src/lib/request-limits";

describe("bounded job-history pagination", () => {
  it("accepts only exact safe unsigned decimal offsets within the route cap", () => {
    expect(parseStrictListOffset(null, 10_000)).toBe(0);
    expect(parseStrictListOffset("0", 10_000)).toBe(0);
    expect(parseStrictListOffset("0002", 10_000)).toBe(2);
    expect(parseStrictListOffset("10000", 10_000)).toBe(10_000);
    for (const invalid of [
      "", " ", " 4", "4 ", "-1", "+1", "2.5", "1e3", "10garbage",
      "10001", "9007199254740992", "Infinity", "0x20",
    ]) expect(parseStrictListOffset(invalid, 10_000), invalid).toBeNull();
  });

  it("uses strict parsing in the customer and Agent job-history API before reading rows", () => {
    const route = readFileSync("src/app/api/jobs/route.ts", "utf8");
    expect(route).toContain('parseStrictListOffset(url.searchParams.get("offset"), MAX_LIST_OFFSET)');
    expect(route).toContain('offset === null');
    expect(route).toContain('code: "INVALID_OFFSET"');
    expect(route).not.toContain('Math.max(parseInt(url.searchParams.get("offset")');
  });
});
