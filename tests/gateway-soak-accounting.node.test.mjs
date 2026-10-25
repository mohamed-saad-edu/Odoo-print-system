import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import * as accounting from "../scripts/acceptance/gateway-soak-accounting.mjs";

function fixture() {
  return {
    limits: { maxDeliveryAttempts: 5, maxAdmissions: 20 },
    witnessSourceHashes: { "src/server/ws.ts": "1".repeat(64), "src/lib/job-delivery.ts": "2".repeat(64) },
    rowTotals: { jobs: 1, operations: 1 },
    admissions: [{ jobId: "job-1", tenantId: "tenant-1", agentId: "agent-1", printerId: "printer-1", installationId: "installation-1", sourceCompanyId: "1", sourceOperationId: "operation-1", bindingDigest: "b".repeat(64), idempotencyKey: "c".repeat(64) }],
    jobs: [{ id: "job-1", tenantId: "tenant-1", agentId: "agent-1", printerId: "printer-1", bindingDigest: "b".repeat(64), status: "failed", knownNotPrinted: true, deliveryAttempts: 1, retries: 0, hasLiveClaim: false }],
    operations: [{ jobId: "job-1", tenantId: "tenant-1", installationId: "installation-1", sourceCompanyId: "1", sourceOperationId: "operation-1", idempotencyKey: "c".repeat(64) }],
    deliveries: [{ jobId: "job-1", tenantId: "tenant-1", agentId: "agent-1", printerId: "printer-1", bindingDigest: "b".repeat(64), installationId: "installation-1", count: 1, integrityVerified: true }],
    completions: [{ jobId: "job-1", count: 1 }],
    replays: [{ jobId: "job-1", count: 1, tenantId: "tenant-1", installationId: "installation-1", sourceCompanyId: "1", sourceOperationId: "operation-1", idempotencyKey: "c".repeat(64) }],
    witnesses: [],
  };
}

function witness(line = 10) {
  return { event: "print.trace.gateway_send", outcome: "requeued", jobId: "job-1", agentId: "agent-1", wireBytes: 6091, overBudget: false,
    provenance: { file: "gateway-soak.log", sha256: "a".repeat(64), line } };
}

test("safe pre-send claim followed by one completion reconciles two attempts without allowing a duplicate delivery", () => {
  const input = fixture(); input.jobs[0].deliveryAttempts = 2; input.witnesses.push(witness());
  const result = accounting.verifyWorkloadAccounting(input);
  assert.equal(result.status, "PASS");
  assert.equal(result.jobs, 1);
  assert.equal(result.attempts, 2);
  assert.equal(result.safePreSendClaims, 1);
});

test("ordinary one-claim admission requires one completion and one exact initial replay", () => {
  const result = accounting.verifyWorkloadAccounting(fixture());
  assert.equal(result.status, "PASS");
  assert.equal(result.attempts, 1);
  assert.equal(result.safePreSendClaims, 0);
});

for (const [name, mutate] of [
  ["an unexplained extra attempt", d => { d.jobs[0].deliveryAttempts = 2; }],
  ["a requeued/noop label without a charged extra claim", d => { d.witnesses.push(witness()); }],
  ["a duplicated witness provenance line", d => { d.jobs[0].deliveryAttempts = 3; d.witnesses.push(witness(), witness()); }],
  ["a delivery beyond the configured budget even with matching witnesses", d => { d.jobs[0].deliveryAttempts = 6; for (let n = 0; n < 5; n++) d.witnesses.push(witness(10 + n)); }],
  ["a refunded/retried delivery loop", d => { d.jobs[0].retries = 1; }],
  ["two raw consumer deliveries hidden behind one map key", d => { d.deliveries[0].count = 2; }],
  ["two successful terminal reports", d => { d.completions[0].count = 2; }],
  ["a missing terminal report", d => { d.completions = []; }],
  ["a missing initial replay", d => { d.replays = []; }],
  ["two initial replay records", d => { d.replays[0].count = 2; }],
  ["a replay sent with another v2 wire key", d => { d.replays[0].idempotencyKey = "d".repeat(64); }],
  ["a replay sent in another operation namespace", d => { d.replays[0].sourceOperationId = "other-operation"; }],
  ["a second logical admission for the same job", d => { d.admissions.push({ ...d.admissions[0] }); }],
  ["an unadmitted durable job", d => { d.jobs.push({ ...d.jobs[0], id: "job-extra" }); d.rowTotals.jobs = 2; }],
  ["a wrong durable tenant", d => { d.jobs[0].tenantId = "foreign-tenant"; }],
  ["a wrong durable printer target", d => { d.jobs[0].printerId = "foreign-printer"; }],
  ["a changed durable execution binding", d => { d.jobs[0].bindingDigest = "d".repeat(64); }],
  ["a changed consumer execution binding", d => { d.deliveries[0].bindingDigest = "d".repeat(64); }],
  ["a wrong consumer Agent", d => { d.deliveries[0].agentId = "foreign-agent"; }],
  ["a wrong consumer installation", d => { d.deliveries[0].installationId = "foreign-installation"; }],
  ["a ledger row bound to another tenant", d => { d.operations[0].tenantId = "foreign-tenant"; }],
  ["a ledger row bound to another installation", d => { d.operations[0].installationId = "foreign-installation"; }],
  ["a ledger row bound to another operation", d => { d.operations[0].sourceOperationId = "other-operation"; }],
  ["a ledger row with another v2 wire key", d => { d.operations[0].idempotencyKey = "d".repeat(64); }],
  ["two operation ledger rows for one admitted job", d => { d.operations.push({ ...d.operations[0] }); d.rowTotals.operations = 2; }],
  ["an unknown physical outcome", d => { d.jobs[0].knownNotPrinted = false; }],
  ["a still-active claim", d => { d.jobs[0].hasLiveClaim = true; }],
  ["a failed payload-integrity observation", d => { d.deliveries[0].integrityVerified = false; }],
  ["an ambiguous send labelled as a retry", d => { d.jobs[0].deliveryAttempts = 2; d.witnesses.push({ ...witness(), outcome: "delivery_unknown" }); }],
  ["an entered send with an exception", d => { d.witnesses.push({ event: "ws.job_send_ambiguous", agentId: "agent-1", provenance: witness().provenance }); }],
  ["an over-budget frame in the bounded corpus", d => { d.jobs[0].deliveryAttempts = 2; d.witnesses.push({ ...witness(), overBudget: true }); }],
  ["a pre-send witness for another Agent", d => { d.jobs[0].deliveryAttempts = 2; d.witnesses.push({ ...witness(), agentId: "foreign-agent" }); }],
  ["a witness without immutable file provenance", d => { d.jobs[0].deliveryAttempts = 2; const w = witness(); delete w.provenance.sha256; d.witnesses.push(w); }],
  ["a witness without production source provenance", d => { delete d.witnessSourceHashes; }],
  ["a truncated per-job database projection", d => { d.rowTotals.jobs = 2; }],
  ["a workload larger than its admission budget", d => { d.limits.maxAdmissions = 0; }],
]) {
  test(`accounting rejects ${name}`, () => {
    const input = fixture(); mutate(input);
    const result = accounting.verifyWorkloadAccounting(input);
    assert.equal(result.status, "FAIL");
    assert(result.violations.length > 0);
  });
}

test("the configured delivery budget is read from the recorded fixed runtime export", () => {
  assert.equal(accounting.readDeliveryAttemptBudget("export const MAX_DELIVERY_ATTEMPTS = 5;\n"), 5);
  assert.equal(accounting.readDeliveryAttemptBudget("export const MAX_DELIVERY_ATTEMPTS = 3;\n"), 3);
  assert.throws(() => accounting.readDeliveryAttemptBudget("export const MAX_DELIVERY_ATTEMPTS = valueFromEnvironment;"));
  const input = fixture(); input.limits.maxDeliveryAttempts = 2;
  input.jobs[0].deliveryAttempts = 3; input.witnesses.push(witness(), witness(11));
  assert.equal(accounting.verifyWorkloadAccounting(input).status, "FAIL");
});

test("a failed diagnostic write cannot prevent the actual harness from reaching Gateway cleanup", async () => {
  const source = fs.readFileSync(new URL("../scripts/acceptance/gateway-soak.mjs", import.meta.url), "utf8");
  const start = source.indexOf('  if (db) {\n    try { await accountingSnapshot("before-cleanup"); }');
  const end = source.indexOf('  for (const ws of consumers.map', start);
  assert(start >= 0 && end > start, "Load the actual accounting-failure and Gateway-cleanup block");
  const primary = { name: "OriginalFailure", message: "retain this original failure" };
  const summary = { status: "FAIL", error: primary };
  const processState = { exitCode: 0 };
  const cleanup = [];
  const context = { db: {}, summary, process: processState,
    accountingSnapshot: async () => { throw Object.assign(new Error("read failure"), { code: "READ_FAILURE" }); },
    save: () => { throw new Error("simulated evidence write failure"); },
    stopGateway: async label => { cleanup.push(label); } };
  await vm.runInNewContext(`(async () => {${source.slice(start, end)}\n})()`, context);
  assert.deepEqual(cleanup, ["cleanup"]);
  assert.equal(summary.status, "FAIL");
  assert.equal(processState.exitCode, 1);
  assert.equal(summary.error, primary);
  assert.equal(summary.accountingCaptureError.diagnosticWriteFailed, true);
});
