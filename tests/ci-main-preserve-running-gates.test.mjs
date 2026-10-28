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

test("CI keeps one running main verification and coalesces superseded pending pushes", () => {
  const source = readFileSync(".github/workflows/ci.yml", "utf8");
  const header = source.split("\njobs:", 1)[0];
  // A shared workflow group must include the branch ref for push runs.
  // Distinct manual/release and merge-group runs cannot be coalesced.
  assert.match(header, /concurrency:\s*\n\s*group:.*github\.event_name == 'push'.*github\.ref.*github\.run_id/);
  // A newer main push must not abort tests already executing on an older SHA.
  assert.match(header, /cancel-in-progress:.*github\.event_name == 'pull_request'/);
  // Per-job per-SHA scopes must remain present: running main jobs are not
  // replaced under the old shared-ref PENDING slot.
});

test("all workflows coalesce superseded main runs without sacrificing release gates", () => {
  const policies = [
    [".github/workflows/ci.yml", "ci-run"],
    [".github/workflows/docker.yml", "docker-run"],
    [".github/workflows/build-windows.yml", "windows-run"],
    [".github/workflows/security-supply-chain.yml", "security-supply-run"],
    [".github/workflows/static-security.yml", "static-security-run"],
    [".github/workflows/native-backports.yml", "native-backports-run"],
  ];
  for (const [file, prefix] of policies) {
    const source = readFileSync(file, "utf8");
    const header = source.split("\njobs:")[0];
    assert.ok(header.includes("group: " + prefix + "-"), "missing unique workflow group: " + file);
    assert.match(header, /concurrency:\s*\n\s*group:.*github\.event_name == 'push'.*github\.ref.*github\.run_id/);
    assert.match(header, /cancel-in-progress:.*github\.event_name == 'pull_request'/);
    assert.ok(header.includes("workflow_dispatch:"), "manual full-release gates must remain: " + file);
    assert.ok(header.includes("merge_group:"), "merge-queue validation must remain: " + file);
  }
});
