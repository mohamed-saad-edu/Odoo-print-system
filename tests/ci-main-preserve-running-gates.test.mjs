import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** Preserve completed and pending per-SHA main checks, while superseding duplicate PR attempts. */
test("main CI preserves already running application and native jobs", () => {
  const source = readFileSync(".github/workflows/ci.yml", "utf8");
  const expected = "cancel-in-progress: ${{ github.event_name == 'pull_request' }}";
  const grouping = "${{ github.event_name == 'pull_request' && github.ref || github.sha }}";
  for (const group of ["agent", "quality", "gateway", "odoo"]) {
    const marker = "group: ci-" + group + "-" + grouping;
    const at = source.indexOf(marker);
    assert.notEqual(at, -1, "missing concurrency gate " + marker);
    const lines = source.slice(at).split("\n").slice(0, 4);
    const actual = lines.find(line => line.includes("cancel-in-progress:"));
    assert.equal(actual?.trim(), expected, "main " + group + " must never be cancelled by next push");
  }
});
