import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";
import { createHash } from "node:crypto";
import test from "node:test";
import { printingContractModules } from "./helpers/printing-contract-vm.mjs";

// Execute the actual handler. Only unavailable infrastructure (Next/Drizzle,
// authentication, telemetry) is replaced; the status machine is real source.
const readTS = (path) => stripTypeScriptTypes(readFileSync(path, "utf8"), { mode: "transform" });
const noop = () => {};
const table = (name) => new Proxy({}, { get: (_, key) => `${name}.${String(key)}` });
const sql = (strings, ...values) => strings.reduce((out, part, i) => out + part + (i < values.length ? String(values[i]) : ""), "");

async function harness({ status = "claimed", lifecycle = {}, updatedRows = 1, token = "claim-current" } = {}) {
  const context = createContext({ Buffer, Date, console, Request, Response, URL });
  const contracts = await printingContractModules(context, sql);
  const verification = contracts.get("printer-operational-verification").namespace;
  const bindingDigest = createHash("sha256").update("fresh-admission-fixture-printer").digest("hex");
  const now = new Date();
  const printer = { id: "printer-1", connectionType: "spooler", protocol: "spooler" };
  const proof = verification.operationalVerificationProjection({ version: 1, printer_id: printer.id,
    verified_at: now.toISOString(), binding_digest: bindingDigest, logical_queue_key: bindingDigest,
    method: "windows_queue", identity_strength: "queue", output_medium: "physical" }, printer, now);
  assert.equal(proof.verificationState, "verified", "fresh admission fixture must satisfy the real operational proof contract");
  const statements = [], writes = [], events = [];
  const job = { id: "job-1", tenantId: "tenant-1", agentId: "agt-1", printerId: "printer-1", status,
    bindingDigest, outputMedium: "physical", outputEvidence: null,
    claimToken: "claim-current", error: null, expiresAt: new Date(Date.now() + 60000), updatedAt: new Date() };
  const active = { agent_lifecycle: "active", tenant_lifecycle: "active", printer_lifecycle: "active",
    inventory_present: true, management_source: "manager", desired_revision: 3,
    verification_state: proof.verificationState, verification_binding_digest: proof.verificationBindingDigest,
    verification_verified_at: proof.verificationVerifiedAt, verification_received_at: proof.verificationReceivedAt,
    logical_queue_key: proof.logicalQueueKey, output_medium: proof.outputMedium,
    applied_desired_revision: 3, observed_desired_revision: 3, ...lifecycle };
  const update = () => {
    let values, fence;
    return { set(v) { values = v; return this; }, where(v) { fence = v; return this; }, async returning() {
      writes.push({ values, fence });
      return updatedRows ? [{ status: values.status, error: values.error }] : [];
    } };
  };
  const db = { query: { printJobs: { findFirst: async () => job } }, update,
    transaction: async (fn) => fn({ update, execute: async (statement) => {
      if (statement.includes("SELECT secret FROM agents")) return { rows: [{ secret: "fixture-agent-secret" }] };
      if (statement.includes("SELECT id FROM tenants") && !statement.includes("lifecycle =")) return { rows: [{ id: "tenant-1" }] };
      statements.push(statement);
      if (statement.includes("SELECT id FROM tenants")) {
        return { rows: active.tenant_lifecycle === "active" ? [{ id: "tenant-1" }] : [] };
      }
      if (statement.includes("FROM print_jobs")) return { rows: [{ id: job.id }] };
      assert.match(statement, /FROM agents a/);
      const verified = verification.isPrinterOperationallyVerified({ ...printer,
        verificationState: active.verification_state, verificationBindingDigest: active.verification_binding_digest,
        verificationVerifiedAt: active.verification_verified_at, verificationReceivedAt: active.verification_received_at,
        logicalQueueKey: active.logical_queue_key, managementSource: active.management_source,
        desiredRevision: active.desired_revision, appliedDesiredRevision: active.applied_desired_revision,
        observedDesiredRevision: active.observed_desired_revision }, now);
      return { rows: verified && job.bindingDigest === active.verification_binding_digest
        && job.outputMedium === active.output_medium ? [active] : [] };
    } }) };
  const mocks = {
    "node:crypto": { createHash },
    "../../../../db": { db },
    "../../../../db/schema": { printJobs: table("jobs"), printJobReceipts: table("receipts") },
    "../../../../lib/agent-auth": { validateAgent: async () => ({ id: "agt-1", tenantId: "tenant-1", secret: "fixture-agent-secret" }) },
    "drizzle-orm": { sql, and: (...v) => v.join(" AND "), eq: (a, b) => `${a}=${b}`, isNull: (v) => `${v} IS NULL` },
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "../../../../lib/log": { logInfo: noop, logWarn: noop, requestIdFrom: () => "request-1" },
    "../../../../lib/metrics": { incrementMetric: noop },
    "../../../../lib/job-maintenance": { MAX_RETRIES: 5, DELIVERY_EVIDENCE_PENDING: "pending" },
    "../../../../lib/job-delivery": { CLAIM_RETURNING: "", MAX_DELIVERY_ATTEMPTS: 5, MAX_AGENT_IN_FLIGHT_JOBS: 64 },
    "../../../../lib/job-fencing": { fencedJobWrite: () => "CLAIM_FENCE", printingAdmissionLifecycleFence: () => ["LIFECYCLE_FENCE"] },
    "../../../../lib/request-limits": { hasBodyOverLimit: () => false },
    "../../../../lib/agent-availability": { agentStaleThresholdSeconds: () => 60, printerStaleThresholdSeconds: () => 60 },
    "../../../../lib/database-clock": { refreshClockSkew: noop },
    "../../../../lib/entitlements": { liveTenantSubscriptionPredicate: () => "LIVE_SUBSCRIPTION" },
    "../../../../lib/job-timeline": { recordJobEvent: async (event) => events.push(event) },
  };
  const route = new SourceTextModule(readTS("src/app/api/agent/jobs/route.ts"), { context });
  await route.link((specifier) => {
    const contract = specifier.startsWith(".") && contracts.get(specifier.split("/").at(-1));
    if (contract) return contract;
    const exports = mocks[specifier];
    assert.ok(exports, `unexpected handler import: ${specifier}`);
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await route.evaluate();
  const patch = (requestedStatus = "printing") => route.namespace.PATCH(new Request("https://gateway.test/api/agent/jobs", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId: job.id, status: requestedStatus, claimToken: token }),
  }));
  return { patch, statements, writes, events };
}

for (const status of ["claimed", "printing"]) {
  for (const [name, lifecycle] of [
    ["disabled printer", { printer_lifecycle: "disabled" }],
    ["removed inventory", { inventory_present: false }],
    ["suspended tenant", { tenant_lifecycle: "suspended" }],
    ["retired agent", { agent_lifecycle: "retired" }],
    ["unapplied desired revision", { applied_desired_revision: 2 }],
    ["unobserved desired revision", { observed_desired_revision: 2 }],
  ]) {
    test(`${status} admission rejects ${name} before a job write`, async () => {
      const h = await harness({ status, lifecycle });
      assert.equal((await h.patch()).status, 409);
      assert.equal(h.writes.length, 0);
      assert.equal(h.events.length, 0);
    });
  }
  test(`${status} admission locks current owner/printer and retains the database expiry fence`, async () => {
    const h = await harness({ status });
    const response = await h.patch();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "printing");
    assert.equal(h.statements.length, 3);
    assert.match(h.statements[0], /SELECT id FROM tenants[\s\S]*WHERE id = tenant-1 AND lifecycle = 'active' FOR SHARE/);
    assert.match(h.statements[1], /pr\.id = printer-1/);
    assert.match(h.statements[1], /pr\.status = 'online'/);
    assert.match(h.statements[1], /pr\.last_seen_at <= now\(\)/);
    assert.match(h.statements[1], /pr\.management_source = 'agent'/);
    assert.match(h.statements[1], /[a-f0-9]{64}::text IS NOT NULL AND pr\.verification_binding_digest = [a-f0-9]{64}/);
    assert.match(h.statements[1], /pr\.output_medium = physical/);
    assert.match(h.statements[1], /pr\.verification_state = 'verified'/);
    assert.match(h.statements[1], /pr\.logical_queue_key = pr\.verification_binding_digest/);
    assert.match(h.statements[1], /pr\.verification_verified_at >= clock_timestamp\(\)/);
    assert.match(h.statements[1], /pr\.verification_received_at <= clock_timestamp\(\)/);
    assert.match(h.statements[1], /LIVE_SUBSCRIPTION/);
    assert.match(h.statements[1], /FOR SHARE OF a, t, pr/);
    assert.match(h.statements[2], /SELECT id FROM print_jobs/);
    assert.match(h.statements[2], /tenant_id = tenant-1 AND agent_id = agt-1/);
    assert.match(h.statements[2], /FOR UPDATE/);
    assert.match(h.writes[0].fence, /jobs\.expiresAt > now\(\)/);
    assert.equal(h.events.length, status === "printing" ? 0 : 1);
  });
  test(`${status} admission refuses a concurrently expired or reclaimed database row`, async () => {
    const h = await harness({ status, updatedRows: 0 });
    assert.equal((await h.patch()).status, 409);
    assert.equal(h.events.length, 0);
  });
}

test("wrong claim cannot enter the admission transaction", async () => {
  const h = await harness({ token: "claim-stale" });
  assert.equal((await h.patch()).status, 409);
  assert.equal(h.statements.length, 0);
  assert.equal(h.writes.length, 0);
});

test("terminal success reconciliation does not request new printer admission", async () => {
  const h = await harness({ status: "printing", lifecycle: { printer_lifecycle: "disabled" } });
  const response = await h.patch("success");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).physicalOutcome, "unknown");
  assert.equal(h.statements.length, 0);
  assert.equal(h.events.length, 1);
});
