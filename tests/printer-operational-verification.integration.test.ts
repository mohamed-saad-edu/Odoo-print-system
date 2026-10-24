import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as register } from "../src/app/api/printers/route";
import { POST as heartbeat } from "../src/app/api/agent/heartbeat/route";
import { GET as inventory } from "../src/app/api/odoo/printers/route";
import { POST as submitJob } from "../src/app/api/print/jobs/route";
import { GET as pollJobs, PATCH as reportStatus } from "../src/app/api/agent/jobs/route";
import { claimJobForDelivery } from "../src/lib/job-delivery";
import { cleanupTerminalPrintJobs } from "../src/lib/job-maintenance";
import { createWorkspaceManagerTestSession } from "./helpers/workspace-session";
import { gatewayTestSigningKey } from "./helpers/test-secrets";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll, type Fixture } from "./helpers/pg";

const suite = describe.skipIf(!hasTestDatabase);
const previousKey = process.env.GATEWAY_JWT_SECRET;
const digest = "a".repeat(64);
const artifact = { output_medium: "file", artifact_id: "artifact_8b5ec4af", sha256: "b".repeat(64), page_count: 2, bytes: 4096 };
suite("Agent-backed operational eligibility and scoped queue identity", () => {
  let fixture: Fixture;
  beforeAll(async () => { process.env.GATEWAY_JWT_SECRET = gatewayTestSigningKey(); await applyMigrations(); });
  beforeEach(async () => {
    await truncateAll(); fixture = await seedFixture();
    await pool().query("UPDATE printers SET config=$1::jsonb WHERE id=$2 AND tenant_id=$3", [JSON.stringify({ spooler_name: "Real Office Queue" }), fixture.printerId, fixture.tenantId]);
  });
  afterAll(async () => { if (previousKey === undefined) delete process.env.GATEWAY_JWT_SECRET; else process.env.GATEWAY_JWT_SECRET = previousKey; await closePool(); });
  const proof = (patch: Record<string, unknown> = {}) => ({ version: 1, verified_at: new Date().toISOString(), printer_id: fixture.printerId,
    binding_digest: digest, logical_queue_key: digest, method: "windows_queue", identity_strength: "queue", output_medium: "physical", ...patch });
  const row = (verification: unknown, patch: Record<string, unknown> = {}) => ({ id: fixture.printerId, name: "Office", printerType: "physical", deviceClass: "laser", connectionType: "spooler", protocol: "spooler", status: "online", config: { spooler_name: "Real Office Queue" }, capabilities: { supported_protocols: ["pdf"], ...(verification === undefined ? {} : { operational_verification: verification }) }, ...patch });
  function observe(printers: unknown[], extra: Record<string, unknown> = {}) {
    return heartbeat(new Request("https://gateway.test/api/agent/heartbeat", { method: "POST", headers: { Authorization: fixture.agentAuth, "Content-Type": "application/json" }, body: JSON.stringify({ status: "online", printers, ...extra }) }));
  }
  function submit(key: string, printerId = fixture.printerId) {
    return submitJob(new Request("https://gateway.test/api/print/jobs", { method: "POST", headers: { Authorization: "Bearer " + fixture.odooKey, "Content-Type": "application/json" }, body: JSON.stringify({ printerId, destination: "POS", documentType: "receipt", idempotencyKey: key, payload: { type: "pdf", encoding: "base64", data: Buffer.from("%PDF-1.4\n%%EOF\n").toString("base64") } }) }));
  }
  async function listed() { const response = await inventory(new Request("https://gateway.test/api/odoo/printers", { headers: { Authorization: "Bearer " + fixture.odooKey } })); expect(response.status).toBe(200); return (await response.json()).printers; }
  const stored = async () => (await pool().query("SELECT * FROM printers WHERE tenant_id=$1 AND id=$2", [fixture.tenantId, fixture.printerId])).rows[0];
  async function managerRegister(body: Record<string, unknown>) {
    const manager = await createWorkspaceManagerTestSession(fixture.tenantId);
    return register(new Request("https://gateway.test/api/printers", { method: "POST", headers: { Authorization: "Bearer " + manager.token, "Content-Type": "application/json" }, body: JSON.stringify({ agentId: fixture.agentId, name: "Configured target", printerType: "physical", deviceClass: "laser", connectionType: "spooler", protocol: "spooler", config: { spooler_name: "Unproven Queue" }, ...body }) }));
  }
  it("does not accept manager capability proof and retains pending registration without routing", async () => {
    const response = await managerRegister({ id: "manual-unproven", capabilities: { operational_verification: proof({ printer_id: "manual-unproven" }) } });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created).toMatchObject({ verificationState: "pending", outputMedium: "physical", capabilities: null });
    const rejected = await submit("pending-manual", created.id);
    expect(rejected.status).toBe(409); expect(await rejected.json()).toMatchObject({ code: "PRINTER_UNVERIFIED" });
    expect((await listed()).some((entry: { id: string }) => entry.id === created.id)).toBe(false);
  });
  it("accepts fresh exact Agent proof and records a separate server receipt", async () => {
    expect((await observe([row(proof())])).status).toBe(200);
    const saved = await stored();
    expect(saved.verification_state).toBe("verified"); expect(saved.verification_received_at).not.toBeNull(); expect(saved.logical_queue_key).toBe(digest);
    expect((await listed()).find((entry: { id: string }) => entry.id === fixture.printerId)).toMatchObject({ verificationState: "verified", outputMedium: "physical" });
    expect((await submit("verified-new")).status).toBe(201);
  });
  it.each([undefined, { wrong: true }, "stale", "future", "wrong-id"])("invalidates eligibility for absent, malformed, expired or wrong-bound proof (%s)", async (kind) => {
    let value: unknown = kind;
    if (kind === "stale") value = proof({ verified_at: new Date(Date.now() - 301000).toISOString() });
    if (kind === "future") value = proof({ verified_at: new Date(Date.now() + 61000).toISOString() });
    if (kind === "wrong-id") value = proof({ printer_id: "different" });
    expect((await observe([row(value)])).status).toBe(200);
    expect((await stored()).verification_state).toBe("pending");
    expect((await listed()).length).toBe(0);
    expect((await submit("unverified-new")).status).toBe(409);
  });
  it("does not bind proof from a previous manager destination even with converged ACKs", async () => {
    await pool().query("UPDATE printers SET management_source='manager',desired_revision=1,applied_desired_revision=1,observed_desired_revision=1 WHERE tenant_id=$1 AND id=$2", [fixture.tenantId, fixture.printerId]);
    expect((await observe([row(proof(), { config: { spooler_name: "Previous Queue" } })])).status).toBe(200);
    expect(await stored()).toMatchObject({ verification_state: "pending", verification_reason: "verification_destination_mismatch", config: { spooler_name: "Real Office Queue" } });
  });
  it("reconciles an exact accepted operation after proof expires, while blocking new work and both claims", async () => {
    expect((await observe([row(proof())])).status).toBe(200);
    const acceptedResponse = await submit("accepted-before-expiry"); expect(acceptedResponse.status).toBe(201); const accepted = await acceptedResponse.json();
    await pool().query("UPDATE printers SET verification_verified_at=clock_timestamp()-interval '301 seconds' WHERE tenant_id=$1 AND id=$2", [fixture.tenantId, fixture.printerId]);
    const replay = await submit("accepted-before-expiry"); expect(replay.status).toBe(200); expect(await replay.json()).toMatchObject({ jobId: accepted.jobId });
    expect((await submit("new-after-expiry")).status).toBe(409);
    expect(await claimJobForDelivery(accepted.jobId, fixture.agentId)).toBeNull();
    const poll = await pollJobs(new Request("https://gateway.test/api/agent/jobs", { headers: { Authorization: fixture.agentAuth } })); expect(poll.status).toBe(200); expect((await poll.json())).toHaveLength(0);
    const retained = (await pool().query("SELECT status,delivery_attempts FROM print_jobs WHERE id=$1", [accepted.jobId])).rows[0]; expect(retained).toEqual({ status: "queued", delivery_attempts: 0 });
  });
  it("keeps two queues on one device distinct and makes a contradictory logical identity collision pending", async () => {
    const secondId = "office-second-queue";
    const second = row(proof({ printer_id: secondId, binding_digest: "c".repeat(64), logical_queue_key: "c".repeat(64) }), { id: secondId, config: { spooler_name: "Real  Office Queue" } });
    expect((await observe([row(proof()), second])).status).toBe(200);
    expect((await pool().query("SELECT id FROM printers WHERE tenant_id=$1", [fixture.tenantId])).rows).toHaveLength(2);
    const conflict = await observe([row(proof({ printer_id: secondId }), { id: secondId, config: { spooler_name: "Real  Office Queue" } })]);
    expect(conflict.status).toBe(200); expect((await conflict.json()).skippedPrinters).toContainEqual({ id: secondId, reason: "logical_queue_identity_collision" });
    expect((await pool().query("SELECT verification_state FROM printers WHERE tenant_id=$1", [fixture.tenantId])).rows.every(entry => entry.verification_state === "pending")).toBe(true);
  });
  it("serializes concurrent manual registration of the same queue without duplicate history", async () => {
    await createWorkspaceManagerTestSession(fixture.tenantId);
    const responses = await Promise.all([managerRegister({}), managerRegister({})]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 201]);
    const bodies = await Promise.all(responses.map(response => response.json())); expect(bodies[0].id).toBe(bodies[1].id);
  });
  it("enforces logical queue uniqueness in PostgreSQL while allowing one physical device across distinct queues and scopes", async () => {
    const key = "d".repeat(64), physical = "e".repeat(64);
    const insert = (id: string) => pool().query("INSERT INTO printers(id,tenant_id,agent_id,name,connection_type,protocol,config,logical_queue_key,physical_device_key) VALUES ($1,$2,$3,$1,'spooler','spooler',$4::jsonb,$5,$6)", [id, fixture.tenantId, fixture.agentId, JSON.stringify({ spooler_name: id }), key, physical]);
    const raced = await Promise.allSettled([insert("race-queue-a"), insert("race-queue-b")]);
    expect(raced.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = raced.find(result => result.status === "rejected") as PromiseRejectedResult; expect(rejected.reason.code).toBe("23505");
    await pool().query("UPDATE printers SET physical_device_key=$1 WHERE tenant_id=$2 AND id=$3", [physical, fixture.tenantId, fixture.printerId]);
    expect((await pool().query("SELECT id FROM printers WHERE tenant_id=$1 AND physical_device_key=$2", [fixture.tenantId, physical])).rows).toHaveLength(2);
    await pool().query("INSERT INTO agents(id,tenant_id,name) VALUES ('another-agent',$1,'Another Agent')", [fixture.tenantId]);
    await pool().query("INSERT INTO printers(id,tenant_id,agent_id,name,connection_type,protocol,config,logical_queue_key) VALUES ('another-scope',$1,'another-agent','Another scope','spooler','spooler',$2::jsonb,$3)", [fixture.tenantId, JSON.stringify({ spooler_name: "Same queue name" }), key]);
    const otherTenant = await seedFixture();
    await pool().query("UPDATE printers SET logical_queue_key=$1,verification_binding_digest=$1 WHERE tenant_id=$2 AND id=$3", [key, otherTenant.tenantId, otherTenant.printerId]);
  });
  it("requires server receipt freshness independently and prevents a claimed job from crossing a later failed verification", async () => {
    expect((await observe([row(proof())])).status).toBe(200);
    const created = await submit("claim-before-verification-fails"); expect(created.status).toBe(201); const accepted = await created.json();
    const claim = await claimJobForDelivery(accepted.jobId, fixture.agentId); expect(claim).not.toBeNull();
    await pool().query("UPDATE printers SET verification_received_at=clock_timestamp()-interval '301 seconds' WHERE tenant_id=$1 AND id=$2", [fixture.tenantId, fixture.printerId]);
    expect((await listed()).length).toBe(0);
    const response = await reportStatus(new Request("https://gateway.test/api/agent/jobs", { method: "PATCH", headers: { Authorization: fixture.agentAuth, "Content-Type": "application/json" }, body: JSON.stringify({ jobId: accepted.jobId, claimToken: claim!.claimToken, status: "printing" }) }));
    expect(response.status).toBe(409);
    expect((await pool().query("SELECT status FROM print_jobs WHERE id=$1", [accepted.jobId])).rows[0].status).toBe("claimed");
  });
  it("binds every new PDF to its admitted endpoint and blocks queued or claimed work after target reconfiguration", async () => {
    expect((await observe([row(proof())])).status).toBe(200);
    const queued = await (await submit("binding-original-queued")).json();
    const claimedJob = await (await submit("binding-original-claimed")).json();
    const claim = await claimJobForDelivery(claimedJob.jobId, fixture.agentId); expect(claim?.bindingDigest).toBe(digest);
    const nextDigest = "f".repeat(64);
    expect((await observe([row(proof({ binding_digest: nextDigest, logical_queue_key: nextDigest }), { config: { spooler_name: "New Office Queue" } })])).status).toBe(200);
    expect(await claimJobForDelivery(queued.jobId, fixture.agentId)).toBeNull();
    const poll = await pollJobs(new Request("https://gateway.test/api/agent/jobs", { headers: { Authorization: fixture.agentAuth } })); expect(await poll.json()).toEqual([]);
    const printing = await reportStatus(new Request("https://gateway.test/api/agent/jobs", { method: "PATCH", headers: { Authorization: fixture.agentAuth, "Content-Type": "application/json" }, body: JSON.stringify({ jobId: claimedJob.jobId, claimToken: claim!.claimToken, status: "printing" }) }));
    expect(printing.status).toBe(409);
    expect((await submit("binding-original-queued")).status).toBe(200);
    expect((await pool().query("SELECT binding_digest FROM print_jobs WHERE id=$1", [queued.jobId])).rows[0].binding_digest).toBe(digest);
    const current = await (await submit("binding-current-target")).json();
    expect((await claimJobForDelivery(current.jobId, fixture.agentId))?.bindingDigest).toBe(nextDigest);
    const legacy = await (await submit("binding-legacy-unbound")).json();
    await pool().query("UPDATE print_jobs SET binding_digest=NULL WHERE id=$1", [legacy.jobId]);
    expect(await claimJobForDelivery(legacy.jobId, fixture.agentId)).toBeNull();
  });
  it("requires verified file creation, preserves exact evidence through terminal replay, and refuses evidence replacement", async () => {
    await pool().query("UPDATE printers SET printer_type='file',connection_type='pdf_output',protocol='pdf',output_medium='file',config=$1::jsonb WHERE tenant_id=$2 AND id=$3", [JSON.stringify({ output_profile_id: "office_archive" }), fixture.tenantId, fixture.printerId]);
    const fileProof = proof({ method: "pdf_output", identity_strength: "service", output_medium: "file" });
    expect((await observe([row(fileProof, { printerType: "file", connectionType: "pdf_output", protocol: "pdf", config: { output_profile_id: "office_archive" } })])).status).toBe(200);
    const created = await submit("pdf-file-job"); expect(created.status).toBe(201); const accepted = await created.json();
    const claim = await claimJobForDelivery(accepted.jobId, fixture.agentId); expect(claim).not.toBeNull();
    const token = claim!.claimToken;
    const report = (outputEvidence?: unknown) => reportStatus(new Request("https://gateway.test/api/agent/jobs", { method: "PATCH", headers: { Authorization: fixture.agentAuth, "Content-Type": "application/json" }, body: JSON.stringify({ jobId: accepted.jobId, claimToken: token, status: "success", ...(outputEvidence === undefined ? {} : { outputEvidence }) }) }));
    expect((await report()).status).toBe(422);
    const success = await report(artifact); expect(success.status).toBe(200); expect(await success.json()).toMatchObject({ outputMedium: "file", outputOutcome: "file_created", outputEvidence: artifact, physicalOutcome: "unknown" });
    expect((await report(artifact)).status).toBe(200);
    expect((await report({ ...artifact, artifact_id: "replacement" })).status).toBe(409);
    expect((await report({ ...artifact, filename: "/private/path.pdf" })).status).toBe(400);
    const job = (await pool().query("SELECT output_medium,output_evidence FROM print_jobs WHERE id=$1", [accepted.jobId])).rows[0]; expect(job).toEqual({ output_medium: "file", output_evidence: artifact });
    await pool().query("UPDATE print_jobs SET updated_at=clock_timestamp()-interval '49 hours' WHERE id=$1", [accepted.jobId]);
    expect(await cleanupTerminalPrintJobs({ agentId: fixture.agentId })).toBe(1);
    expect((await report(artifact)).status).toBe(200);
    expect((await report({ ...artifact, artifact_id: "replacement" })).status).toBe(409);
  });
});
