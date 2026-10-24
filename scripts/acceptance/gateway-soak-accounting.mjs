// Acceptance-only reconciliation. No database or application side effects.
import assert from "node:assert/strict";

export function readDeliveryAttemptBudget(source) {
  const matches = [...source.matchAll(/^export const MAX_DELIVERY_ATTEMPTS = (\d+);$/gm)];
  assert.equal(matches.length, 1, "The recorded runtime must declare one fixed delivery-attempt budget");
  const value = Number(matches[0][1]);
  assert(Number.isSafeInteger(value) && value > 0, "Invalid runtime delivery-attempt budget");
  return value;
}

export function verifyWorkloadAccounting(input) {
  const violations = [], perJob = [];
  const fail = (code, jobId, field) => violations.push({ code, ...(jobId ? { jobId } : {}), ...(field ? { field } : {}) });
  const limit = input.limits ?? {};
  if (!Number.isSafeInteger(limit.maxDeliveryAttempts) || limit.maxDeliveryAttempts < 1
      || !Number.isSafeInteger(limit.maxAdmissions) || limit.maxAdmissions < 1) fail("INVALID_BUDGET");
  const arrays = ["admissions", "jobs", "operations", "deliveries", "completions", "replays", "witnesses"];
  for (const key of arrays) if (!Array.isArray(input[key])) fail("MISSING_PROJECTION", null, key);
  for (const file of ["src/server/ws.ts", "src/lib/job-delivery.ts"]) {
    if (!/^[a-f0-9]{64}$/.test(input.witnessSourceHashes?.[file] ?? "")) fail("MISSING_WITNESS_SOURCE", null, file);
  }
  if (violations.length) return { status: "FAIL", violations, perJob };
  if (input.admissions.length < 1 || input.admissions.length > limit.maxAdmissions) fail("ADMISSION_BUDGET");

  const index = (rows, key, label) => {
    const result = new Map();
    for (const row of rows) {
      const id = row?.[key];
      if (typeof id !== "string" || !id) { fail("INVALID_ID", null, label); continue; }
      if (result.has(id)) fail("DUPLICATE_RECORD", id, label);
      result.set(id, row);
    }
    return result;
  };
  const admitted = index(input.admissions, "jobId", "admissions");
  const jobs = index(input.jobs, "id", "jobs"), operations = index(input.operations, "jobId", "operations");
  const deliveries = index(input.deliveries, "jobId", "deliveries"), completions = index(input.completions, "jobId", "completions");
  const replays = index(input.replays, "jobId", "replays");
  for (const [name, rows] of [["jobs", jobs], ["operations", operations], ["deliveries", deliveries], ["completions", completions], ["replays", replays]]) {
    if (rows.size !== admitted.size) fail("COHORT_SIZE", null, name);
    for (const id of rows.keys()) if (!admitted.has(id)) fail("UNADMITTED_RECORD", id, name);
  }
  if (input.rowTotals?.jobs !== input.jobs.length || input.rowTotals?.operations !== input.operations.length) fail("TRUNCATED_DATABASE_PROJECTION");

  const noSend = new Map(), provenance = new Set();
  for (const witness of input.witnesses) {
    const id = witness.jobId, expected = admitted.get(id), proof = witness.provenance;
    const validProof = proof && /^gateway-[a-z0-9-]+\.log$/.test(proof.file ?? "")
      && /^[a-f0-9]{64}$/.test(proof.sha256 ?? "") && Number.isSafeInteger(proof.line) && proof.line > 0;
    const proofKey = validProof ? `${proof.file}:${proof.sha256}:${proof.line}` : null;
    if (!validProof || provenance.has(proofKey)) { fail("INVALID_WITNESS_PROVENANCE", id); continue; }
    provenance.add(proofKey);
    if (witness.event !== "print.trace.gateway_send" || witness.outcome !== "requeued"
        || witness.overBudget !== false || !Number.isSafeInteger(witness.wireBytes) || witness.wireBytes < 1) {
      fail("UNSAFE_SEND_WITNESS", id); continue;
    }
    if (!expected || witness.agentId !== expected.agentId) { fail("WRONG_WITNESS_TARGET", id); continue; }
    noSend.set(id, (noSend.get(id) ?? 0) + 1);
  }

  const same = (actual, expected, keys, label) => {
    for (const key of keys) if (typeof expected[key] !== "string" || !expected[key] || actual?.[key] !== expected[key]) fail("IDENTITY_MISMATCH", expected.jobId, `${label}.${key}`);
  };
  let attempts = 0, retries = 0, knownNotPrinted = 0, active = 0;
  for (const [id, admission] of admitted) {
    const job = jobs.get(id), delivery = deliveries.get(id), completion = completions.get(id), replay = replays.get(id);
    same(job, admission, ["tenantId", "agentId", "printerId", "bindingDigest"], "job");
    same(operations.get(id), admission, ["tenantId", "installationId", "sourceCompanyId", "sourceOperationId", "idempotencyKey"], "operation");
    same(delivery, admission, ["tenantId", "agentId", "printerId", "installationId", "bindingDigest"], "consumer");
    same(replay, admission, ["tenantId", "installationId", "sourceCompanyId", "sourceOperationId", "idempotencyKey"], "replay");
    if (job?.status === "failed" && job.knownNotPrinted === true) knownNotPrinted += 1;
    else fail("NOT_KNOWN_NOT_PRINTED", id);
    if (["queued", "claimed", "printing"].includes(job?.status)) active += 1;
    if (job?.hasLiveClaim !== false) fail("LIVE_OR_UNPROVEN_CLAIM", id);
    if (job?.retries !== 0) fail("NONZERO_RETRIES", id);
    if (Number.isSafeInteger(job?.retries)) retries += job.retries;
    if (!Number.isSafeInteger(job?.deliveryAttempts) || job.deliveryAttempts < 1 || job.deliveryAttempts > limit.maxDeliveryAttempts) fail("DELIVERY_BUDGET", id);
    else attempts += job.deliveryAttempts;
    if (delivery?.count !== 1 || delivery.integrityVerified !== true) fail("DELIVERY_OR_INTEGRITY_COUNT", id);
    if (completion?.count !== 1) fail("COMPLETION_COUNT", id);
    if (replay?.count !== 1) fail("INITIAL_REPLAY_COUNT", id);
    const safe = noSend.get(id) ?? 0;
    // A "requeued" log also covers a no-op release in the current runtime.
    // It grants no allowance by itself: both a surplus witness and an extra
    // durable attempt without a matching pre-send witness must fail.
    if (job?.deliveryAttempts !== 1 + safe) fail("UNBALANCED_ATTEMPTS", id);
    perJob.push({ jobId: id, attempts: job?.deliveryAttempts ?? null, safePreSendWitnesses: safe,
      deliveries: delivery?.count ?? 0, completions: completion?.count ?? 0, initialReplays: replay?.count ?? 0 });
  }
  return { status: violations.length ? "FAIL" : "PASS", jobs: input.jobs.length, knownNotPrinted, active,
    attempts, retries, safePreSendClaims: [...noSend.values()].reduce((sum, count) => sum + count, 0),
    violations, perJob,
    scope: "Exact per-job durable-counter, authenticated operation-ledger and synthetic-consumer reconciliation; no physical printer is exercised.",
    limitation: "Pre-send control-flow witnesses are reconciled against durable final counters. The requeued label alone is insufficient and is not a durable history of individual claim tokens." };
}
