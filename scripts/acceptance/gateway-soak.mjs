/**
 * Local, synthetic HTTPS/WSS operational acceptance. No transport backend exists.
 * Run: DATABASE_URL=<disposable-loopback-createdb-role> node --import tsx
 *   scripts/acceptance/gateway-soak.mjs /absolute/evidence/output
 * YASEIR_SOAK_SECONDS defaults to 900 (three equal windows), warmup is 60s.
 * Optional stress profile: YASEIR_SOAK_JOBS_PER_SECOND=6
 *   YASEIR_SOAK_CONCURRENCY=12 YASEIR_SOAK_SLOW_READERS=1
 *   YASEIR_SOAK_UNKNOWN_RESTART=1. Limits are validated against fixture quotas.
 * Private generated credentials/snapshots never enter the evidence directory.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fork, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { updateGitDeltaHash } from "./gateway-soak-source.mjs";
import { readDeliveryAttemptBudget, verifyWorkloadAccounting } from "./gateway-soak-accounting.mjs";
import { createWorkloadCorpus, syntheticPrinterProfile, workloadAsset, workloadPayload, verifyPayloadIntegrity, WORKLOAD_FORMAT_DISTRIBUTION } from "./gateway-soak-payloads.mjs";
import { physicalPrinterIdentityKey } from "../../src/lib/physical-printer-identity.ts";
import { validatePrinterOperationalVerification } from "../../src/lib/printer-operational-verification.ts";

const root = process.cwd(), out = path.resolve(process.argv[2] || "");
const maxDeliveryAttempts = readDeliveryAttemptBudget(fs.readFileSync(path.join(root, "src/lib/job-maintenance.ts"), "utf8"));
assert(process.argv[2] && !fs.existsSync(path.join(out, "summary.json")), "Supply a new evidence output directory");
fs.mkdirSync(out, { recursive: true });
const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), "yaseir-soak-private-")); fs.chmodSync(privateDir, 0o700);
const require = createRequire(path.join(root, "package.json"));
const { Pool } = require("pg"), { WebSocket } = require("ws");
const base = new URL(process.env.DATABASE_URL || "");
assert(["127.0.0.1", "::1", "localhost"].includes(base.hostname), "Loopback database required");
const database = `yaseir_operations_${Date.now()}_${randomBytes(3).toString("hex")}`;
const asDatabase = name => { const u = new URL(base); u.pathname = `/${name}`; return u.toString(); };
const admin = new Pool({ connectionString: asDatabase("postgres"), max: 1 });
let db, gateway, proxy, agent, heartbeatTimer, sampleTimer, reconnectTimer, pollTimer, slowReaderTimer, created = false, stopping = false, phase = "setup";
let checkpointBusy = false, reconnectBusy = false, slowReaderBusy = false;
let runtimeDatabaseUrl = asDatabase(database), roleProfile;
const dedicatedRoleProfile = process.env.YASEIR_SOAK_DEDICATED_ROLE_PROFILE === "1";
const consumers = [], accepted = [], records = [], checkpoints = [], faults = [], errors = [];
const deliveries = new Map(), terminal = new Map(), initialReplays = new Map(), expectedPayloads = new Map(), pendingConsumers = new Set(), sockets = new Set();
const gatewayLogFiles = [];
let corpus;
const start = performance.now(), runId = randomBytes(6).toString("hex");
const duration = Number(process.env.YASEIR_SOAK_SECONDS || 900), warmupSeconds = Number(process.env.YASEIR_SOAK_WARMUP_SECONDS || 60);
const jobsPerSecond = Number(process.env.YASEIR_SOAK_JOBS_PER_SECOND || 2);
const concurrency = Number(process.env.YASEIR_SOAK_CONCURRENCY || 1);
const slowReaders = process.env.YASEIR_SOAK_SLOW_READERS === "1";
const unknownRestartEnabled = process.env.YASEIR_SOAK_UNKNOWN_RESTART === "1";
assert(Number.isFinite(jobsPerSecond) && jobsPerSecond >= 1 && jobsPerSecond <= 6, "Rate must be 1..6 jobs/second within the fixture's per-tenant quota");
assert(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 24, "Concurrency must be 1..24");
const maxAdmissions = Math.ceil((duration + warmupSeconds) * jobsPerSecond * 1.02) + 4 * concurrency + 49;
const snapshotMode = process.env.YASEIR_HEAP_SNAPSHOT_MODE || "end";
assert(["none", "end", "checkpoints"].includes(snapshotMode));
assert(Number.isInteger(duration) && duration >= 30 && duration <= 86400, "Duration must be 30..86400 seconds");
assert(Number.isInteger(warmupSeconds) && warmupSeconds >= 0 && warmupSeconds <= 600);
const hash = x => createHash("sha256").update(x).digest("hex");
const save = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + "\n");
const log = data => { const row = { utc: new Date().toISOString(), elapsedMs: performance.now() - start, phase, ...data }; fs.appendFileSync(path.join(out, "progress.jsonl"), JSON.stringify(row) + "\n"); console.log(JSON.stringify(row)); };
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
async function sourceState() {
  const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  const delta = createHash("sha256");
  await updateGitDeltaHash(root, delta);
  for (const name of git("ls-files", "--others", "--exclude-standard", "-z").toString().split("\0").filter(Boolean).sort()) {
    delta.update(name); delta.update(fs.readFileSync(path.join(root, name)));
  }
  const built = createHash("sha256");
  const walk = directory => { for (const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b) => a.name.localeCompare(b.name))) { const file=path.join(directory,entry.name); if (entry.isDirectory()) walk(file); else if (entry.isFile()) { built.update(path.relative(root,file)); built.update(fs.readFileSync(file)); } } };
  walk(path.join(root,".next/server"));
  return { revision: git("rev-parse", "HEAD").toString().trim(), workingDeltaSha256: delta.digest("hex"), compiledServerTreeSha256: built.digest("hex"),
    buildId: fs.readFileSync(path.join(root, ".next/BUILD_ID"), "utf8").trim(),
    serverSha256: hash(fs.readFileSync(path.join(root, "server.ts"))),
    modules: Object.fromEntries(["src/db/index.ts", "src/server/ws.ts", "src/server/request-guard.ts", "src/lib/job-delivery.ts", "src/lib/job-maintenance.ts", "src/lib/print-job-service.ts", "src/lib/printer-geometry.ts", "src/lib/printer-capability.ts", "src/lib/printer-operational-verification.ts", "src/lib/printer-verification-sql.ts", "src/lib/physical-printer-identity.ts", "src/lib/payload.ts", "src/app/api/agent/heartbeat/route.ts", "src/app/api/agent/jobs/route.ts", "src/app/api/print/jobs/v2/route.ts", "scripts/acceptance/gateway-soak.mjs", "scripts/acceptance/gateway-soak-accounting.mjs", "scripts/acceptance/gateway-soak-payloads.mjs", "scripts/acceptance/gateway-soak-source.mjs", "contracts/printer-geometry-contract.json", "contracts/print-payload-contract.json", "contracts/printer-operational-verification-contract.json"].map(n => [n, hash(fs.readFileSync(path.join(root, n)))])) };
}
const summary = { status: "RUNNING", startedUtc: new Date().toISOString(), source: await sourceState(),
  node: process.version, database, syntheticOnly: true, physicalOutput: "No printer backend; ordinary consumers report failed/not_printed before execution; the optional ambiguity cohort intentionally withholds its outcome",
  instrumentation: { resourceSampleMs: 1000, majorGcBetweenWindows: true, heapSnapshotMode: snapshotMode, snapshotOverhead: "Memory sampling at a checkpoint precedes any snapshot. Default end mode creates no snapshot until after all workload and settle measurements." },
  workload: { tenants: 3, agentsPerTenant: 2, printersPerAgent: 1, odooInstallationsPerTenant: 2, repeatedSourceOperationAcrossInstallations: true, targetNewJobsPerSecond: jobsPerSecond, maxAdmittedJobs: maxAdmissions, maxConcurrentProducers: concurrency, replayPerJob: 1, statusEveryJobs: 10,
    slowConsumers: slowReaders ? { delayedAckAndTerminalAgentCount: 1, delayMs: 750, pausedSocketAgentCount: 1, pauseMs: 3500, pauseIntervalMs: 45000 } : null,
    unknownOutcomeRestart: unknownRestartEnabled, maxDeliveryAttempts, operationalVerification: "Fresh simulated Agent proof through the authenticated heartbeat; shared contract validation; exact binding checked before synthetic ACK/outcome",
    warmupSeconds, continuousLoadSeconds: duration, windows: 3, payloadFormatPercent: WORKLOAD_FORMAT_DISTRIBUTION, payloadCorpus: "payload-corpus.json", syntheticProfileDpi: [203, 300, 600], syntheticProfilePaperWidthMM: [58, 80], payloadIntegrityCheckedBeforeOutcome: true, heartbeatSeconds: 20, reconnectSeconds: 30, pollFallbackSeconds: 5 },
  limitations: ["Local synthetic loopback workload, not physical printer throughput or a production capacity claim", "Forced major GC and heap snapshots occur between measured windows", "Heap constructor census reports shallow size, not dominator retained bytes", "Node TLS fixture is not a deployed Caddy/container staging environment", "Synthetic validated profiles are explicit fixtures, not discovered hardware measurements or native Agent fingerprint execution", "Valid RAW/JPEG/PDF documents exercise transfer, admission, persistence and integrity; no Agent renderer, spooler, IPP or physical printer is invoked"] };

function request(route, { method = "GET", body, headers = {}, caOverride } = {}) {
  const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body)), t = performance.now();
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(route, summary.origin), { method, agent: caOverride === false ? false : agent,
      ...(caOverride === false ? {} : { ca: fs.readFileSync(path.join(privateDir, "ca.pem")) }), timeout: 15000,
      headers: { origin: summary.origin, ...(bytes ? { "content-type": "application/json", "content-length": bytes.length } : {}), ...headers } }, res => {
      const chunks = []; let n = 0;
      res.on("data", chunk => { n += chunk.length; if (n > 8 << 20) res.destroy(new Error("Response exceeded 8MiB")); else chunks.push(chunk); });
      res.once("error", reject); res.once("end", () => { const text = Buffer.concat(chunks).toString(); let json; try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, json, milliseconds: performance.now() - t }); });
    });
    req.once("timeout", () => req.destroy(new Error("HTTP deadline exceeded"))); req.once("error", reject); req.end(bytes);
  });
}
function expectStatus(result, status, stage) { assert.equal(result.status, status, `${stage}: ${result.status} ${result.json?.code || result.json?.error || ""}`); return result; }
const odooHeaders = f => ({ authorization: `Bearer ${f.odooKey}`, "x-yaseir-odoo-idempotency-version": "2", "x-yaseir-odoo-installation": f.installationId, "x-yaseir-odoo-proof": f.proof });
function jobBody(f, operation, index) {
  assert(Number.isSafeInteger(index) && index >= 0 && index < maxAdmissions, "Workload admission budget exceeded before enqueue");
  const asset = workloadAsset(corpus, f, index), payload = workloadPayload(asset, f);
  expectedPayloads.set(`${f.printerId}:${index}`, { fixture: asset.id, kind: asset.kind, format: asset.format,
    decodedBytes: asset.bytes.length, sha256: asset.sha256, protocol: payload.protocol, geometryFingerprint: payload.geometry_fingerprint });
  return { printerId: f.printerId, documentType: `operations-synthetic-${index}`, payload,
    idempotencyVersion: 2, installationId: f.installationId, sourceCompanyId: "1", sourceOperationId: operation,
    idempotencyKey: hash(JSON.stringify(["yaseir-odoo-v2", f.installationId, "1", operation])) };
}
async function heartbeat(f) {
  if (checkpointBusy || f.heartbeatBusy || stopping) return; f.heartbeatBusy = true;
  try {
    const now = new Date(), observedAt = now.toISOString();
    const printer = { id: f.printerId, name: "Synthetic operations queue", printerType: "physical", deviceClass: "other", connectionType: "spooler", protocol: "spooler", status: "online", sharedWithGateway: true, config: f.config,
      capabilities: { ...f.capabilities, geometry: { ...f.capabilities.geometry, observed_at: observedAt } } };
    // Only explicit synthetic ASCII spooler queues are represented here. For
    // this transport the shared endpoint identity hashes the same canonical
    // queue as Agent PrinterBindingDigest. No native probe or hardware exists.
    assert.match(printer.config.spooler_name, /^SYNTHETIC_NO_TRANSPORT_\d+$/);
    const identity = physicalPrinterIdentityKey(printer);
    assert.match(identity || "", /^v2:[a-f0-9]{64}$/);
    const bindingDigest = identity.slice(3);
    if (f.bindingDigest) assert.equal(bindingDigest, f.bindingDigest, "Synthetic execution binding changed during workload");
    f.bindingDigest = bindingDigest;
    printer.capabilities.operational_verification = { version: 1, verified_at: observedAt, printer_id: f.printerId,
      binding_digest: bindingDigest, logical_queue_key: bindingDigest, method: "windows_queue", identity_strength: "queue", output_medium: "physical" };
    const verified = validatePrinterOperationalVerification(printer.capabilities.operational_verification, printer, now);
    assert(verified.ok, `Synthetic operational proof rejected: ${verified.reason || "invalid"}`);
    const result = await request("/api/agent/heartbeat", { method: "POST", headers: { authorization: f.agentAuth }, body: { status: "online", heartbeatPage: 1, heartbeatPageCount: 1, inventoryComplete: true, inventorySnapshotId: randomUUID(), inventorySnapshotVersion: String(Date.now()), printers: [printer] } });
    expectStatus(result, 200, "heartbeat");
    assert.equal((result.json?.skippedPrinters || []).length, 0, "Synthetic proof/identity observation was skipped");
  } finally { f.heartbeatBusy = false; }
}
function consumeJob(f, job, transport) {
  if (!job?.id || !job.claimToken || job.agentId !== f.agentId || job.printerId !== f.printerId) { errors.push({ stage: "consumer", message: "wrong identity/target" }); return; }
  if (!f.bindingDigest || job.bindingDigest !== f.bindingDigest) { errors.push({ stage: "execution-binding", message: "missing or changed immutable execution binding" }); return; }
  let expected;
  try {
    const match = /^operations-synthetic-(\d+)$/.exec(job.documentType || "");
    assert(match, "Delivered document identity changed");
    expected = expectedPayloads.get(`${f.printerId}:${match[1]}`);
    assert(expected, "Unadmitted document reached consumer");
    verifyPayloadIntegrity(job.payload, expected);
  } catch (error) { errors.push({ stage: "payload-integrity", utc: new Date().toISOString(), phase, message: error.message }); return; }
  deliveries.set(job.id, { count: (deliveries.get(job.id)?.count || 0) + 1, receivedAt: performance.now(), agentId: f.agentId, transport,
    tenantId: f.tenantId, printerId: job.printerId, installationId: f.installationId, bindingDigest: job.bindingDigest,
    payloadKind: expected.kind, payloadFormat: expected.format, payloadBytes: expected.decodedBytes, payloadSha256: expected.sha256, integrityVerified: true });
  if (f.withholdNextOutcome) {
    f.withholdNextOutcome = false; f.withheldJob = job;
    return; // Intentionally lost synthetic outcome; no printer transport exists.
  }
  const pending = (async () => {
    if (f.consumerDelayMs) await sleep(f.consumerDelayMs);
    if (transport === "websocket" && f.socket?.readyState === WebSocket.OPEN) f.socket.send(JSON.stringify({ type: "job_ack", jobId: job.id, claimToken: job.claimToken }));
    return request("/api/agent/jobs", { method: "PATCH", headers: { authorization: f.agentAuth }, body: { jobId: job.id, claimToken: job.claimToken, status: "failed", error: "OPERATIONS_SYNTHETIC_NO_PRINT: no transport backend exists" } });
  })()
    .then(result => { expectStatus(result, 200, "terminal report"); assert.equal(result.json.physicalOutcome, "not_printed"); terminal.set(job.id, (terminal.get(job.id) || 0) + 1); })
    .catch(error => errors.push({ stage: "terminal", message: error.message })).finally(() => pendingConsumers.delete(pending));
  pendingConsumers.add(pending);
}
async function pollConsumer(f) {
  if (checkpointBusy || f.pollBusy || stopping) return; f.pollBusy = true;
  try { const response = expectStatus(await request("/api/agent/jobs", { headers: { authorization: f.agentAuth } }), 200, "poll fallback"); assert(Array.isArray(response.json)); for (const job of response.json) consumeJob(f, job, "poll"); }
  catch (e) { errors.push({ stage: "poll", message: e.message }); }
  finally { f.pollBusy = false; }
}
async function connectConsumer(f) {
  const began = performance.now();
  const handshake = (event, details = {}) => fs.appendFileSync(path.join(out, "handshakes.jsonl"), JSON.stringify({ utc: new Date().toISOString(), elapsedMs: performance.now() - start, phase, agentId: f.agentId, event, milliseconds: performance.now() - began, ...details }) + "\n");
  const ws = new WebSocket(`${summary.origin.replace("https:", "wss:")}/api/agent/ws`, { ca: fs.readFileSync(path.join(privateDir, "ca.pem")), headers: { authorization: f.agentAuth }, handshakeTimeout: 10000 });
  f.socket = ws; sockets.add(ws);
  ws.once("upgrade", response => handshake("upgrade", { status: response.statusCode }));
  ws.once("open", () => handshake("open"));
  ws.once("error", error => handshake("error", { message: error.message }));
  ws.on("error", error => { if (!stopping) errors.push({ stage: "consumer", message: error.message }); });
  ws.once("close", (code) => { sockets.delete(ws); fs.appendFileSync(path.join(out, "consumer-events.jsonl"), JSON.stringify({ event: "close", agentId: f.agentId, code, phase }) + "\n"); });
  ws.on("message", data => {
    let frame; try { frame = JSON.parse(data.toString()); } catch { errors.push({ stage: "consumer", message: "invalid JSON frame" }); return; }
    if (frame.type !== "print_job") return;
    consumeJob(f, frame.job, "websocket");
  });
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
}
async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  await new Promise(resolve => { const timer = setTimeout(() => { ws.terminate(); resolve(); }, 2000); ws.once("close", () => { clearTimeout(timer); resolve(); }); ws.close(1000, "synthetic reconnect"); });
}
async function waitTerminal(id) {
  const deadline = performance.now() + 15000;
  while (!terminal.has(id) && performance.now() < deadline) { if (errors.length) throw new Error(errors.at(-1).message); await sleep(10); }
  assert(terminal.has(id), "Terminal evidence deadline exceeded");
}
async function checkpoint(name) {
  checkpointBusy = true;
  phase = `checkpoint-${name}`;
  // A heap snapshot intentionally blocks the child event loop. Suspend the
  // harness's own HTTP producers and drain their in-flight requests so that
  // diagnostic pauses cannot manufacture production HTTP timeout findings.
  while (reconnectBusy || slowReaderBusy || consumers.some(f => f.pollBusy || f.heartbeatBusy)) await sleep(20);
  await Promise.all([...pendingConsumers]);
  let result;
  try { result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { gateway.removeListener("message", onMessage); reject(new Error("Checkpoint timeout")); }, 30000);
    const onMessage = m => { if (m?.type === "checkpoint" && m.name === name) { clearTimeout(timer); gateway.removeListener("message", onMessage); resolve(m); } };
    gateway.on("message", onMessage); gateway.send({ type: "checkpoint", name, snapshot: snapshotMode === "checkpoints" || (snapshotMode === "end" && name === "settled") });
  }); } finally { checkpointBusy = false; }
  checkpoints.push(result); save("checkpoints.json", checkpoints); log({ event: "checkpoint", name, rssMiB: result.after.memory.rss / 1048576, heapUsedMiB: result.after.memory.heapUsed / 1048576 });
}
async function sampleDatabase() {
  if (!db || sampleDatabase.busy) return; sampleDatabase.busy = true;
  try {
    const queue = (await db.query("SELECT tenant_id,count(*)::int total,count(*) FILTER (WHERE status='queued')::int queued,count(*) FILTER (WHERE status IN ('claimed','printing'))::int active,count(*) FILTER (WHERE status='failed')::int terminal,max(EXTRACT(EPOCH FROM now()-created_at)) FILTER (WHERE status='queued') AS oldest_queued_seconds FROM print_jobs GROUP BY tenant_id ORDER BY tenant_id")).rows;
    const stats = (await db.query("SELECT numbackends,xact_commit,xact_rollback,temp_files,temp_bytes,deadlocks FROM pg_stat_database WHERE datname=current_database()")).rows[0];
    const sessions = (await db.query("SELECT state,wait_event_type,count(*)::int count FROM pg_stat_activity WHERE datname=current_database() GROUP BY state,wait_event_type ORDER BY state,wait_event_type")).rows;
    const storage = (await db.query("SELECT pg_database_size(current_database())::text AS database_bytes,pg_total_relation_size('print_jobs')::text AS print_jobs_bytes,pg_wal_lsn_diff(pg_current_wal_lsn(),'0/0')::text AS cluster_wal_bytes")).rows[0];
    const waits = (await db.query("SELECT wait_event_type,wait_event,count(*)::int count,max(EXTRACT(EPOCH FROM clock_timestamp()-xact_start)) AS oldest_transaction_seconds,count(*) FILTER(WHERE cardinality(pg_blocking_pids(pid))>0)::int blocked_sessions FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() GROUP BY wait_event_type,wait_event")).rows;
    fs.appendFileSync(path.join(out, "database-samples.jsonl"), JSON.stringify({ utc: new Date().toISOString(), phase, queue, stats, sessions, storage, waits }) + "\n");
  } catch (e) { errors.push({ stage: "database-sample", message: e.message }); } finally { sampleDatabase.busy = false; }
}
async function startGateway(label) {
  const logFile = `gateway-${label}.log`;
  gatewayLogFiles.push(logFile);
  const fd = fs.openSync(path.join(out, logFile), "a", 0o600);
  // Never inherit operator secrets, *_FILE overrides, NODE_OPTIONS or provider
  // credentials. This process sees only this drill's generated identities.
  const operatingEnvironment = Object.fromEntries(["PATH", "LD_LIBRARY_PATH"].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  const runtimeEnvironment = { ...operatingEnvironment, TZ: "UTC", LANG: "C.UTF-8", NEXT_TELEMETRY_DISABLED: "1", DATABASE_URL: runtimeDatabaseUrl, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(summary.httpPort), APP_BASE_URL: summary.origin,
    GATEWAY_JWT_SECRET: summary.privateJwt, TRUST_PROXY: "1", TRUST_PROXY_SECRET: summary.privateProxy, PLATFORM_TENANT_ID: consumers[0].tenantId, COOKIE_SECURE: "1", RESEND_API_KEY: "", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "",
    YASEIR_PROBE_OUTPUT: path.join(out, `memory-${label}.jsonl`), YASEIR_PROBE_PRIVATE: privateDir };
  if (roleProfile) {
    runtimeEnvironment.PGUSER = roleProfile.runtime;
    runtimeEnvironment.PGPASSWORD = roleProfile.runtimePassword;
    runtimeEnvironment.PGDATABASE = database;
    for (const key of ["DATABASE_URL_FILE", "PGPASSWORD_FILE", "POSTGRES_PASSWORD", "POSTGRES_PASSWORD_FILE", "POSTGRES_OWNER_PASSWORD", "POSTGRES_OWNER_PASSWORD_FILE", "POSTGRES_RUNTIME_PASSWORD", "POSTGRES_RUNTIME_PASSWORD_FILE"]) delete runtimeEnvironment[key];
  }
  gateway = fork(path.join(root, "server.ts"), [], { cwd: root, execArgv: ["--expose-gc", "--require", path.join(root, "scripts/acceptance/gateway-memory-probe.cjs"), "--import", "tsx"],
    env: runtimeEnvironment, stdio: ["ignore", fd, fd, "ipc"] });
  fs.closeSync(fd);
  const deadline = performance.now() + 60000;
  while (performance.now() < deadline) {
    if (gateway.exitCode !== null || gateway.signalCode !== null) throw new Error(`Gateway startup exited ${gateway.exitCode}/${gateway.signalCode}`);
    try { if ((await request("/api/health")).status === 200) return; } catch {}
    await sleep(200);
  }
  throw new Error("Gateway readiness deadline exceeded");
}
async function stopGateway(label) {
  if (!gateway || gateway.exitCode !== null || gateway.signalCode !== null) return;
  const t = performance.now(), child = gateway;
  const result = await new Promise(resolve => { const timer = setTimeout(() => { child.kill("SIGKILL"); }, 15000); child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); }); child.kill("SIGTERM"); });
  faults.push({ event: "graceful-shutdown", label, elapsedMs: performance.now() - t, ...result });
  assert.equal(result.code, 0, "Gateway graceful shutdown must exit successfully");
}

async function accountingSnapshot(name, verify = false) {
  // All database/log reads run after a measured window cohort has settled, or
  // during final cleanup. Never add a per-request query to the measured path.
  const snapshotPool = new Pool({ connectionString: asDatabase(database), max: 1, connectionTimeoutMillis: 5000,
    statement_timeout: 5000, options: "-c timezone=UTC -c default_transaction_read_only=on" });
  let client;
  let rowTotals, jobs, operations;
  try {
    client = await snapshotPool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    rowTotals = (await client.query("SELECT (SELECT count(*)::int FROM print_jobs) AS jobs, (SELECT count(*)::int FROM odoo_v2_operations) AS operations")).rows[0];
    jobs = (await client.query(`SELECT id,tenant_id AS "tenantId",agent_id AS "agentId",printer_id AS "printerId",status,
      (position('OPERATIONS_SYNTHETIC_NO_PRINT:' in COALESCE(error,''))=1) AS "knownNotPrinted",
      delivery_attempts AS "deliveryAttempts",retries,(claim_token IS NOT NULL) AS "hasLiveClaim",
      delivered_at AS "deliveredAt",acked_at AS "ackedAt",binding_digest AS "bindingDigest"
      FROM print_jobs ORDER BY id LIMIT $1`, [maxAdmissions + 1])).rows;
    operations = (await client.query(`SELECT accepted_job_id AS "jobId",tenant_id AS "tenantId",installation_id AS "installationId",
      source_company_id AS "sourceCompanyId",source_operation_id AS "sourceOperationId",idempotency_key AS "idempotencyKey"
      FROM odoo_v2_operations ORDER BY tenant_id,installation_id,source_company_id,source_operation_id LIMIT $1`, [maxAdmissions + 1])).rows;
    await client.query("COMMIT");
  } catch (error) {
    try { if (client) await client.query("ROLLBACK"); } catch { /* Preserve the first query failure. */ }
    throw error;
  } finally { client?.release(); await snapshotPool.end(); }
  const witnesses = [], logPrefixes = [];
  for (const file of gatewayLogFiles) {
    const bytes = fs.readFileSync(path.join(out, file));
    const prefix = { file, sha256: hash(bytes), bytes: bytes.length };
    logPrefixes.push(prefix);
    for (const [index, line] of bytes.toString("utf8").split("\n").entries()) {
      let row; try { row = JSON.parse(line); } catch { continue; }
      if (row.event !== "print.trace.gateway_send" && row.event !== "ws.job_send_ambiguous"
          && !(row.event === "print.trace.gateway_delivery" && !["delivered", "not_claimable"].includes(row.outcome))) continue;
      witnesses.push({ event: row.event, jobId: row.jobId, agentId: row.agentId, outcome: row.outcome,
        wireBytes: row.wireBytes, overBudget: row.overBudget, utc: row.ts, provenance: { ...prefix, line: index + 1 } });
    }
  }
  const snapshot = { utc: new Date().toISOString(), phase, limits: { maxAdmissions, maxDeliveryAttempts }, rowTotals, jobs, operations,
    witnessSourceHashes: Object.fromEntries(["src/server/ws.ts", "src/lib/job-delivery.ts"].map(file => [file, summary.source.modules[file]])),
    admissions: accepted.map(item => { const f = consumers[item.fixtureIndex]; return { jobId: item.jobId, tenantId: f.tenantId,
      agentId: f.agentId, printerId: f.printerId, installationId: f.installationId, sourceCompanyId: "1", sourceOperationId: item.operation,
      bindingDigest: item.bindingDigest, idempotencyKey: item.idempotencyKey }; }),
    deliveries: [...deliveries].map(([jobId, value]) => ({ jobId, tenantId: value.tenantId, agentId: value.agentId,
      printerId: value.printerId, installationId: value.installationId, bindingDigest: value.bindingDigest, count: value.count, integrityVerified: value.integrityVerified })),
    completions: [...terminal].map(([jobId, count]) => ({ jobId, count })),
    replays: [...initialReplays].map(([jobId, value]) => ({ jobId, ...value })), witnesses, logPrefixes,
    ambiguityCohortJobIds: consumers.map(f => f.withheldJob?.id).filter(Boolean),
    scope: "Bounded read-only per-job and operation-ledger projection. Log SHA256 values bind the exact prefix byte lengths read here; logs may subsequently append. No payloads, bearer tokens or credential proofs are included." };
  const file = `accounting-${name}.json`;
  save(file, snapshot); // Keep the evidence even when the following check fails.
  if (!verify) return snapshot;
  const report = verifyWorkloadAccounting(snapshot);
  save(`accounting-${name}-verification.json`, report);
  summary.accounting = [...(summary.accounting || []), { phase: name, file, status: report.status, safePreSendClaims: report.safePreSendClaims }];
  assert.equal(report.status, "PASS", `Per-job accounting failed: ${JSON.stringify(report.violations.slice(0, 10))}`);
  return { jobs: report.jobs, known_not_printed: report.knownNotPrinted, active: report.active,
    attempts: report.attempts, retries: report.retries, safe_pre_send_claims: report.safePreSendClaims };
}

async function loadWindow(name, seconds) {
  phase = name; gateway.send({ type: "phase", phase });
  const begin = performance.now(), deadline = begin + seconds * 1000, pending = new Set();
  let next = begin, n = 0, nextIndex = accepted.length, peakConcurrent = 0, producerFailure;
  const produce = async index => {
    const t = performance.now(), f = consumers[index % consumers.length], operation = `${runId}-operation-${Math.floor(index / consumers.length)}`, body = jobBody(f, operation, index);
    const response = expectStatus(await request("/api/print/jobs/v2", { method: "POST", body, headers: odooHeaders(f) }), 201, "enqueue");
    const jobId = response.json.jobId; assert(jobId);
    accepted.push({ jobId, operation, index, fixtureIndex: index % consumers.length, phase: name,
      bindingDigest: f.bindingDigest, idempotencyKey: body.idempotencyKey });
    const payload = expectedPayloads.get(`${f.printerId}:${index}`);
    const payloadRecord = { payloadKind: payload.kind, payloadFormat: payload.format, payloadBytes: payload.decodedBytes, fixture: payload.fixture };
    records.push({ type: "enqueue", phase: name, jobId, milliseconds: response.milliseconds, ...payloadRecord });
    await waitTerminal(jobId);
    assert.equal(deliveries.get(jobId).count, 1, "One logical admission must have one delivery");
    records.push({ type: "dispatch", phase: name, jobId, milliseconds: deliveries.get(jobId).receivedAt - t, ...payloadRecord });
    records.push({ type: "completion", phase: name, jobId, milliseconds: performance.now() - t, ...payloadRecord });
    const replay = expectStatus(await request("/api/print/jobs/v2", { method: "POST", body, headers: odooHeaders(f) }), 200, "exact replay");
    assert.equal(replay.json.jobId, jobId); initialReplays.set(jobId, { count: (initialReplays.get(jobId)?.count || 0) + 1,
      tenantId: f.tenantId, installationId: body.installationId, sourceCompanyId: body.sourceCompanyId,
      sourceOperationId: body.sourceOperationId, idempotencyKey: body.idempotencyKey });
    records.push({ type: "replay", phase: name, jobId, milliseconds: replay.milliseconds, ...payloadRecord });
    if (index % 10 === 0) { const status = expectStatus(await request(`/api/print/jobs/v2?id=${encodeURIComponent(jobId)}`, { headers: odooHeaders(f) }), 200, "status"); assert.equal(status.json.status, "failed"); records.push({ type: "status", phase: name, milliseconds: status.milliseconds, ...payloadRecord }); }
    if (index % 100 === 0) {
      const foreign = consumers[(index % consumers.length + 2) % consumers.length];
      assert.notEqual(foreign.tenantId, f.tenantId);
      expectStatus(await request(`/api/print/jobs/v2?id=${encodeURIComponent(jobId)}`, { headers: odooHeaders(foreign) }), 404, "foreign-tenant job status");
      summary.tenantIsolationProbes = (summary.tenantIsolationProbes || 0) + 1;
    }
    n += 1; if (n % 60 === 0) log({ event: "load-progress", accepted: accepted.length, windowJobs: n, elapsedSeconds: (performance.now() - begin) / 1000 });
  };
  while (performance.now() < deadline && !producerFailure) {
    if (pending.size >= concurrency) { await Promise.race(pending); continue; }
    await sleep(next - performance.now()); if (performance.now() >= deadline || producerFailure) break;
    next = performance.now() + 1000 / jobsPerSecond;
    const task = produce(nextIndex++).catch(error => { producerFailure ??= error; }).finally(() => pending.delete(task));
    pending.add(task); peakConcurrent = Math.max(peakConcurrent, pending.size);
  }
  await Promise.all(pending);
  if (producerFailure) throw producerFailure;
  const elapsedSeconds = (performance.now() - begin) / 1000;
  return { phase: name, jobs: n, elapsedSeconds, achievedJobsPerSecond: n / elapsedSeconds, peakConcurrentProducers: peakConcurrent };
}
function percentiles(values) { const v = values.sort((a, b) => a - b); return { count: v.length, p50Ms: v[Math.ceil(v.length * .5) - 1], p95Ms: v[Math.ceil(v.length * .95) - 1], p99Ms: v[Math.ceil(v.length * .99) - 1], maxMs: v.at(-1) }; }

try {
  corpus = await createWorkloadCorpus();
  save("payload-corpus.json", { scope: "Deterministic synthetic source documents, no native rendering or physical acceptance", distributionPercent: WORKLOAD_FORMAT_DISTRIBUTION, assets: corpus.manifest });
  await admin.query(`CREATE DATABASE "${database}"`); created = true;
  db = new Pool({ connectionString: asDatabase(database), max: 2, options: "-c timezone=UTC", statement_timeout: 10000 });
  const { migrateByHash } = await import(pathToFileURL(path.join(root, "scripts/db-migrate.ts")).href);
  if (dedicatedRoleProfile) {
    assert(process.env.YASEIR_FRESH_ROLE_CLUSTER === "1", "Role-profile soak requires a separately owned fresh dedicated cluster");
    const { applyProfile, verifyRuntime } = await import(pathToFileURL(path.join(root, "scripts/postgres-role-profile.mjs")).href);
    const config = { host: base.hostname, port: +(base.port || 5432), database, bootstrap: decodeURIComponent(base.username), password: decodeURIComponent(base.password),
      owner: "yaseir_owner", runtime: "yaseir_runtime", ownerPassword: randomBytes(32).toString("hex"), runtimePassword: randomBytes(32).toString("hex") };
    const bootstrap = await db.connect();
    try { await applyProfile(bootstrap, config, privateDir); roleProfile = config; } finally { bootstrap.release(); }
    const owner = new Pool({ host: config.host, port: config.port, database, user: config.owner, password: config.ownerPassword, max: 1 });
    try { const client = await owner.connect(); try { await migrateByHash(client, path.join(root, "drizzle")); } finally { client.release(); } } finally { await owner.end(); }
    const url = new URL(asDatabase(database)); url.username = config.runtime; url.password = config.runtimePassword; runtimeDatabaseUrl = url.toString();
    const runtime = new Pool({ connectionString: runtimeDatabaseUrl, max: 1 });
    try { const client = await runtime.connect(); try { summary.databasePrivilegeProfile = { ...(await verifyRuntime(client, config.runtime)), ownerMigrations: true, bootstrapCredentialExcludedFromGateway: true }; } finally { client.release(); } } finally { await runtime.end(); }
  } else {
    const client = await db.connect(); try { await migrateByHash(client, path.join(root, "drizzle")); } finally { client.release(); }
    summary.databasePrivilegeProfile = { mode: "disposable-createdb-fixture-role", productionRoleProfile: false };
  }
  for (let ti = 0; ti < 3; ti++) {
    const suffix = randomBytes(6).toString("hex"), tenantId = `tenant_ops_${suffix}`, planId = `plan_ops_${suffix}`, apiKeyId = `key_ops_${suffix}`, odooKey = `odoo_${randomBytes(32).toString("base64url")}`;
    await db.query("INSERT INTO tenants(id,name,odoo_idempotency_mode) VALUES($1,'Synthetic operations tenant','strict_v2')", [tenantId]);
    await db.query("INSERT INTO plans(id,name,entitlements) VALUES($1,$2,$3::jsonb)", [planId, `Synthetic bounded operations plan ${suffix}`, JSON.stringify({ max_agents: 2, max_printers: 2, max_jobs_per_minute: 180, max_concurrent_jobs: 64, max_prints_per_period: 10000 })]);
    await db.query("INSERT INTO tenant_subscriptions(tenant_id,plan_id,status,current_period_start,current_period_end) VALUES($1,$2,'active',now()-interval '1 minute',now()+interval '1 month')", [tenantId, planId]);
    await db.query("INSERT INTO api_keys(id,tenant_id,name,hashed_key,odoo_enabled,odoo_enabled_revision) VALUES($1,$2,'Synthetic operations key',$3,true,0)", [apiKeyId, tenantId, hash(odooKey)]);
    for (let ai = 0; ai < 2; ai++) {
      const installationId = randomUUID(), proof = randomBytes(32).toString("base64url");
      await db.query("INSERT INTO odoo_installations(id,tenant_id,name,secret_hash,enabled) VALUES($1,$2,'Synthetic operations installation',$3,true)", [installationId, tenantId, hash(proof)]);
      await db.query("INSERT INTO odoo_installation_credentials(tenant_id,installation_id,api_key_id) VALUES($1,$2,$3)", [tenantId, installationId, apiKeyId]);
      const agentId = `agt_${randomBytes(6).toString("base64url").slice(0, 8)}`, secret = randomBytes(32).toString("base64url"), printerId = `printer_ops_${suffix}_${ai}`;
      await db.query("INSERT INTO agents(id,tenant_id,name,secret,status,lifecycle,last_seen_at) VALUES($1,$2,'Synthetic no-transport agent',$3,'online','active',now())", [agentId, tenantId, hash(secret)]);
      const profile = syntheticPrinterProfile(printerId, consumers.length);
      await db.query("INSERT INTO printers(id,tenant_id,agent_id,name,printer_type,device_class,connection_type,protocol,status,lifecycle,config,capabilities,last_seen_at) VALUES($1,$2,$3,'Synthetic operations queue','physical','other','spooler','spooler','online','active',$4::jsonb,$5::jsonb,now())", [printerId, tenantId, agentId, JSON.stringify(profile.config), JSON.stringify(profile.capabilities)]);
      consumers.push({ tenantId, agentId, agentAuth: `Bearer ${agentId}:${secret}`, printerId, odooKey, installationId, proof, ...profile, consumerDelayMs: slowReaders && ti === 0 && ai === 0 ? 750 : 0 });
    }
  }
  const openssl = args => execFileSync("openssl", args, { stdio: "pipe" });
  const key = path.join(privateDir, "server-key.pem"), cert = path.join(privateDir, "server.pem"), ca = path.join(privateDir, "ca.pem"), caKey = path.join(privateDir, "ca-key.pem");
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", caKey, "-out", ca, "-days", "2", "-sha256", "-subj", "/CN=Synthetic operations CA", "-addext", "basicConstraints=critical,CA:TRUE"]);
  openssl(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", path.join(privateDir, "server.csr"), "-subj", "/CN=127.0.0.1"]);
  fs.writeFileSync(path.join(privateDir, "extensions.conf"), "subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\n");
  openssl(["x509", "-req", "-in", path.join(privateDir, "server.csr"), "-CA", ca, "-CAkey", caKey, "-set_serial", "1", "-out", cert, "-days", "2", "-sha256", "-extfile", path.join(privateDir, "extensions.conf")]);
  summary.httpPort = Number(process.env.YASEIR_SOAK_HTTP_PORT || 42141);
  summary.privateProxy = randomBytes(32).toString("hex"); summary.privateJwt = randomBytes(48).toString("hex");
  const proxyHeaders = req => { const h = { ...req.headers }; for (const k of Object.keys(h)) if (k.startsWith("x-forwarded-") || ["forwarded", "x-real-ip", "x-gateway-proxy-token"].includes(k)) delete h[k]; return { ...h, "x-forwarded-proto": "https", "x-forwarded-for": "127.0.0.1", "x-gateway-proxy-token": summary.privateProxy }; };
  proxy = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert), minVersion: "TLSv1.2" }, (req, res) => {
    const up = http.request({ hostname: "127.0.0.1", port: summary.httpPort, method: req.method, path: req.url, headers: proxyHeaders(req), timeout: 15000 }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); }); up.on("timeout", () => up.destroy()); req.on("aborted", () => up.destroy()); req.pipe(up);
  });
  proxy.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  proxy.on("upgrade", (req, socket, head) => {
    const up = http.request({ hostname: "127.0.0.1", port: summary.httpPort, path: req.url, headers: proxyHeaders(req), timeout: 10000 });
    up.on("upgrade", (res, peer, first) => { sockets.add(peer); peer.once("close", () => sockets.delete(peer)); socket.write(`HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n${res.rawHeaders.reduce((s, h, i, all) => i % 2 ? s : s + h + ": " + all[i + 1] + "\r\n", "")}\r\n`); if (head.length) peer.write(head); if (first.length) socket.write(first); socket.on("error", () => peer.destroy()); peer.on("error", () => socket.destroy()); socket.pipe(peer).pipe(socket); });
    up.on("response", r => { socket.end(`HTTP/1.1 ${r.statusCode} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); r.resume(); }); up.on("error", () => socket.destroy()); up.on("timeout", () => up.destroy()); up.end();
  });
  await new Promise(r => proxy.listen(0, "127.0.0.1", r)); summary.origin = `https://127.0.0.1:${proxy.address().port}`;
  agent = new https.Agent({ keepAlive: true, maxSockets: 12, ca: fs.readFileSync(ca) });
  await startGateway("soak");
  await assert.rejects(request("/api/live", { caOverride: false }), /certificate|verify|self.signed|issuer/i);
  summary.tls = { trustedCA: "PASS", untrustedCARejected: true, minimumVersion: "TLSv1.2" };
  for (const f of consumers) { await heartbeat(f); await connectConsumer(f); }
  save("synthetic-printer-profiles.json", { scope: "Explicit simulated Agent observations through authenticated heartbeat; no native probe or physical measurement", printers: consumers.map(f => ({ printerId: f.printerId, bindingDigest: f.bindingDigest, config: f.config, capabilities: f.capabilities })) });
  heartbeatTimer = setInterval(() => { void Promise.all(consumers.map(heartbeat)).catch(e => errors.push({ stage: "heartbeat", message: e.message })); }, 20000);
  pollTimer = setInterval(() => { void Promise.all(consumers.map(pollConsumer)); }, 5000);
  let reconnectIndex = 0;
  reconnectTimer = setInterval(() => { if (reconnectBusy || slowReaderBusy || checkpointBusy || stopping) return; reconnectBusy = true; const f = consumers[reconnectIndex++ % consumers.length];
    void closeSocket(f.socket).then(() => connectConsumer(f)).then(() => faults.push({ event: "wss-reconnect", agentId: f.agentId, phase })).catch(e => errors.push({ stage: "reconnect", message: e.message })).finally(() => { reconnectBusy = false; }); }, 30000);
  if (slowReaders) slowReaderTimer = setInterval(() => {
    if (reconnectBusy || slowReaderBusy || checkpointBusy || stopping) return;
    const socket = consumers[1].socket;
    if (socket?.readyState !== WebSocket.OPEN) return;
    slowReaderBusy = true;
    const pausedAt = performance.now(); socket.pause();
    void sleep(3500).then(() => {
      socket.resume();
      faults.push({ event: "slow-websocket-reader", agentId: consumers[1].agentId, phase, elapsedMs: performance.now() - pausedAt });
    }).finally(() => { slowReaderBusy = false; });
  }, 45000);
  sampleTimer = setInterval(() => void sampleDatabase(), 5000); await sampleDatabase();
  summary.databaseBefore = (await db.query("SELECT xact_rollback,temp_files,temp_bytes,deadlocks FROM pg_stat_database WHERE datname=current_database()")).rows[0];
  log({ event: "ready", buildId: summary.source.buildId, plannedSeconds: duration, gatewayPid: gateway.pid });
  summary.windows = [await loadWindow("warmup", warmupSeconds)]; phase = "checkpoint-warm"; await checkpoint("warm");
  for (let w = 1; w <= 3; w++) { summary.windows.push(await loadWindow(`load-${w}`, duration / 3)); phase = `checkpoint-${w}`; await checkpoint(`window-${w}`); }
  clearInterval(reconnectTimer); reconnectTimer = null; clearInterval(slowReaderTimer); slowReaderTimer = null;
  while (reconnectBusy || slowReaderBusy) await sleep(20);
  phase = "settle"; gateway.send({ type: "phase", phase }); await sleep(10000); await checkpoint("settled");
  summary.databaseAfter = (await db.query("SELECT xact_rollback,temp_files,temp_bytes,deadlocks FROM pg_stat_database WHERE datname=current_database()")).rows[0];
  summary.durable = await accountingSnapshot("post-load", true);
  assert.equal(errors.length, 0, "No background consumer/DB errors");
  summary.tenantProgress = (await db.query("SELECT tenant_id,count(*)::int jobs,count(DISTINCT agent_id)::int agents FROM print_jobs GROUP BY tenant_id ORDER BY tenant_id")).rows;
  summary.queryPlans = (await db.query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id,status,created_at FROM print_jobs WHERE tenant_id=$1 AND agent_id=$2 AND status='queued' ORDER BY created_at LIMIT 64", [consumers[0].tenantId, consumers[0].agentId])).rows;
  save("query-plan.json", summary.queryPlans); delete summary.queryPlans;
  summary.deliveryTransports = [...deliveries.values()].reduce((a,v) => (a[v.transport] = (a[v.transport] || 0) + 1, a), {});
  phase = "queued-restart"; clearInterval(heartbeatTimer); heartbeatTimer = null; clearInterval(pollTimer); pollTimer = null;
  while (consumers.some(f => f.pollBusy || f.heartbeatBusy)) await sleep(20);
  await Promise.all(consumers.map(f => closeSocket(f.socket)));
  await Promise.all([...pendingConsumers]);
  const queuedRestart = [];
  for (let n = 0; n < consumers.length * 8; n++) {
    const index = accepted.length, f = consumers[index % consumers.length], operation = `${runId}-${index}`, body = jobBody(f,operation,index);
    const response = expectStatus(await request("/api/print/jobs/v2",{method:"POST",body,headers:odooHeaders(f)}),201,"durable queued admission");
    const replay = expectStatus(await request("/api/print/jobs/v2",{method:"POST",body,headers:odooHeaders(f)}),200,"queued exact replay");
    assert.equal(replay.json.jobId,response.json.jobId);
    initialReplays.set(response.json.jobId, { count: (initialReplays.get(response.json.jobId)?.count || 0) + 1,
      tenantId: f.tenantId, installationId: body.installationId, sourceCompanyId: body.sourceCompanyId,
      sourceOperationId: body.sourceOperationId, idempotencyKey: body.idempotencyKey });
    const item = {jobId:response.json.jobId,operation,index,fixtureIndex:index % consumers.length,phase,
      bindingDigest: f.bindingDigest, idempotencyKey: body.idempotencyKey};
    accepted.push(item); queuedRestart.push(item);
  }
  const queuedBefore = (await db.query("SELECT count(*)::int n FROM print_jobs WHERE status='queued'")).rows[0].n;
  assert.equal(queuedBefore,queuedRestart.length,"All restart-cohort jobs must still be durably queued");
  log({event:"queued-before-restart",jobs:queuedBefore,agents:consumers.length});
  await stopGateway("after-soak");
  await startGateway("restart");
  for (const f of consumers) { await heartbeat(f); await connectConsumer(f); }
  const drainStarted = performance.now();
  await Promise.all(consumers.map(pollConsumer));
  await Promise.all(queuedRestart.map(item => waitTerminal(item.jobId)));
  summary.queueRestart = { queuedBefore,terminalAfter:queuedRestart.length,drainMilliseconds:performance.now()-drainStarted,
    perAgent:consumers.map(f => ({agentId:f.agentId,jobs:queuedRestart.filter(item => consumers[item.fixtureIndex].agentId === f.agentId).length})),
    scope:"Eight durable queued jobs for every one of six agents across three tenants survive a Gateway restart and drain through authenticated polling without changing identity" };
  for (const item of accepted.filter((_, i) => i % Math.max(1, Math.floor(accepted.length / 30)) === 0)) {
    const f = consumers[item.fixtureIndex], body = jobBody(f, item.operation, item.index);
    const replay = expectStatus(await request("/api/print/jobs/v2", { method: "POST", body, headers: odooHeaders(f) }), 200, "post-restart replay"); assert.equal(replay.json.jobId, item.jobId);
    const status = expectStatus(await request(`/api/print/jobs/v2?id=${item.jobId}`, { headers: odooHeaders(f) }), 200, "post-restart status"); assert.equal(status.json.status, "failed");
  }
  summary.restart = { identityReplay: "PASS", durableJobsBefore: accepted.length, durableJobsAfter: (await db.query("SELECT count(*)::int n FROM print_jobs")).rows[0].n };
  assert.equal(summary.restart.durableJobsAfter, accepted.length);
  summary.durableAfterRestart = await accountingSnapshot("post-restart", true);
  for (const [id, value] of deliveries) assert.equal(value.count, 1, `Duplicate delivery ${id}`);
  if (unknownRestartEnabled) {
    phase = "unknown-outcome-restart";
    const f = consumers[0], operation = `${runId}-unknown-restart`, index = accepted.length;
    const body = { ...jobBody(f, operation, index), expiresAt: new Date(Date.now() + 15_000).toISOString() };
    f.withholdNextOutcome = true;
    const admitted = expectStatus(await request("/api/print/jobs/v2", { method: "POST", body, headers: odooHeaders(f) }), 201, "unknown-outcome admission");
    const jobId = admitted.json.jobId;
    const deliveryDeadline = performance.now() + 15_000;
    while (!f.withheldJob && performance.now() < deliveryDeadline) await sleep(10);
    assert.equal(f.withheldJob?.id, jobId, "The ambiguous cohort must actually cross the socket before restart");
    let before;
    const evidenceDeadline = performance.now() + 15_000;
    do {
      before = (await db.query("SELECT status,delivered_at,delivery_attempts FROM print_jobs WHERE id=$1", [jobId])).rows[0];
      if (before?.delivered_at) break;
      await sleep(10);
    } while (performance.now() < evidenceDeadline);
    assert.equal(before.status, "claimed"); assert(before.delivered_at); assert.equal(before.delivery_attempts, 1);
    // Let the declared TTL expire while the Gateway is stopped. On restart,
    // normal maintenance/polling must retain uncertainty instead of resending.
    await stopGateway("unknown-outcome");
    await sleep(Math.max(0, Date.parse(body.expiresAt) - Date.now() + 100));
    await startGateway("unknown-restart");
    for (const consumer of consumers) { await heartbeat(consumer); await connectConsumer(consumer); }
    await Promise.all(consumers.map(pollConsumer));
    const replay = expectStatus(await request("/api/print/jobs/v2", { method: "POST", body, headers: odooHeaders(f) }), 200, "unknown-outcome exact replay");
    assert.equal(replay.json.jobId, jobId);
    const status = expectStatus(await request(`/api/print/jobs/v2?id=${encodeURIComponent(jobId)}`, { headers: odooHeaders(f) }), 200, "unknown-outcome status");
    const after = (await db.query("SELECT status,error,delivery_attempts,retries FROM print_jobs WHERE id=$1", [jobId])).rows[0];
    save("unknown-outcome-restart.json", { jobId, before, status: status.json, after, deliveries: deliveries.get(jobId).count });
    // The Odoo v2 status contract carries physical uncertainty in the error
    // marker, unlike the Agent PATCH response's physicalOutcome property.
    assert.match(status.json.error, /^UNKNOWN_PARTIAL_DELIVERY:/);
    assert(["failed", "expired"].includes(status.json.status));
    assert.equal(deliveries.get(jobId).count, 1, "Unknown physical outcome must never be automatically redelivered");
    assert.equal(after.status, status.json.status); assert.equal(after.error, status.json.error);
    assert.equal(after.delivery_attempts, 1); assert.equal(after.retries, 0);
    summary.unknownOutcomeRestart = { jobId, beforeStatus: before.status, afterStatus: after.status, physicalOutcome: "unknown", marker: "UNKNOWN_PARTIAL_DELIVERY",
      deliveries: deliveries.get(jobId).count, attempts: after.delivery_attempts, retries: after.retries, exactReplayPreserved: true,
      scope: "Synthetic delivered frame with no ACK/outcome; expired while Gateway stopped; restart, poll and exact replay preserve unknown outcome without redelivery" };
  }
  summary.totalAdmittedJobs = accepted.length + (summary.unknownOutcomeRestart ? 1 : 0);
  const isolation = (await db.query("SELECT count(DISTINCT installation_id)::int installations,count(*)::int operations,count(DISTINCT accepted_job_id)::int distinct_jobs FROM odoo_v2_operations")).rows[0];
  const repeatedOperations = (await db.query("SELECT count(*)::int n FROM (SELECT source_operation_id FROM odoo_v2_operations GROUP BY source_operation_id HAVING count(DISTINCT installation_id)=6 AND count(DISTINCT accepted_job_id)=6) x")).rows[0].n;
  assert.equal(isolation.installations, 6); assert.equal(isolation.operations, summary.totalAdmittedJobs); assert.equal(isolation.distinct_jobs, summary.totalAdmittedJobs);
  assert(repeatedOperations > 0, "Identical source operation identifiers across all six installations must produce six independently fenced jobs");
  summary.installationIsolation = { ...isolation, operationIdentifiersWithSixDistinctJobs: repeatedOperations, scope: "Same company and operation strings deliberately reused across six authenticated installation scopes in three tenants" };
  summary.latencies = Object.fromEntries(["enqueue", "dispatch", "completion", "replay", "status"].map(type => [type, percentiles(records.filter(r => r.type === type && r.phase.startsWith("load-")).map(r => r.milliseconds))]));
  summary.payloadIntegrity = { verifiedJobs: [...deliveries.values()].filter(d => d.integrityVerified).length, admittedJobs: summary.totalAdmittedJobs,
    decodedBytes: [...deliveries.values()].reduce((n, d) => n + d.payloadBytes, 0),
    byFormat: Object.fromEntries(["raw", "image", "pdf"].map(format => [format, [...deliveries.values()].filter(d => d.payloadFormat === format).length])) };
  assert.equal(summary.payloadIntegrity.verifiedJobs, summary.totalAdmittedJobs, "Every admitted job must preserve its payload bytes and geometry binding");
  summary.latenciesByPayloadKind = Object.fromEntries(Object.keys(WORKLOAD_FORMAT_DISTRIBUTION).map(kind => [kind,
    Object.fromEntries(["enqueue", "dispatch", "completion", "replay"].map(type => [type, percentiles(records.filter(r => r.type === type && r.payloadKind === kind && r.phase.startsWith("load-")).map(r => r.milliseconds))]))]));
  summary.sourceAfter = await sourceState();
  assert.equal(summary.sourceAfter.workingDeltaSha256, summary.source.workingDeltaSha256, "Source files changed during the soak");
  assert.equal(summary.sourceAfter.buildId,summary.source.buildId,"The production build changed during the soak");
  assert.equal(summary.sourceAfter.compiledServerTreeSha256,summary.source.compiledServerTreeSha256,"Compiled server tree changed during the soak");
  assert.equal(summary.sourceAfter.serverSha256,summary.source.serverSha256,"Custom server source changed during the soak");
  assert.deepEqual(summary.sourceAfter.modules,summary.source.modules,"Measured runtime modules changed during the soak");
  assert.equal(errors.length,0,"No background errors after restart acceptance");
  summary.status = "PASS";
} catch (error) {
  summary.status = "FAIL"; summary.error = { name: error.name, message: error.message, stack: error.stack }; process.exitCode = 1; log({ event: "failed", message: error.message });
} finally {
  stopping = true; for (const timer of [heartbeatTimer, sampleTimer, reconnectTimer, pollTimer, slowReaderTimer]) clearInterval(timer);
  while (reconnectBusy || slowReaderBusy) await sleep(20);
  while (consumers.some(f => f.pollBusy || f.heartbeatBusy)) await sleep(20);
  while (sampleDatabase.busy) await sleep(20);
  await Promise.allSettled([...pendingConsumers]);
  if (db) {
    try { await accountingSnapshot("before-cleanup"); }
    catch (error) {
      const captureError = { name: "AccountingSnapshotError", code: typeof error.code === "string" ? error.code : null,
        scope: "The final read-only projection failed; original failure details and cleanup continue unchanged." };
      summary.accountingCaptureError = captureError; summary.status = "FAIL"; process.exitCode = 1;
      // Evidence storage can itself fail (for example, disk full). It must
      // never take ownership of cleanup or replace the original run error.
      try { save("accounting-before-cleanup-error.json", captureError); }
      catch { captureError.diagnosticWriteFailed = true; }
    }
  }
  try { await stopGateway("cleanup"); } catch (e) { summary.cleanupError = e.message; summary.status = "FAIL"; process.exitCode = 1; }
  for (const ws of consumers.map(f => f.socket)) if (ws?.readyState !== WebSocket.CLOSED) ws?.terminate();
  agent?.destroy(); for (const socket of sockets) { socket.destroy?.(); socket.terminate?.(); }
  if (proxy) await new Promise(r => proxy.close(r));
  if (db) await db.end();
  if (created) { try { await admin.query(`DROP DATABASE "${database}"`); summary.databaseDropped = true; } catch (e) { summary.databaseDropped = false; summary.cleanupError = e.message; summary.status = "FAIL"; process.exitCode = 1; } }
  if (roleProfile) {
    try { await admin.query(`DROP ROLE "${roleProfile.runtime}"`); await admin.query(`DROP ROLE "${roleProfile.owner}"`); summary.profileRolesDropped = true; }
    catch { summary.profileRolesDropped = false; summary.cleanupError = "Synthetic profile role removal failed"; summary.status = "FAIL"; process.exitCode = 1; }
  }
  await admin.end();
  if (errors.length) { summary.backgroundErrorCount=errors.length; summary.status="FAIL"; process.exitCode=1; }
  const snapshots = fs.readdirSync(privateDir).filter(n => n.endsWith(".heapsnapshot"));
  if (snapshots.length) {
    const order = ["warm", "window-1", "window-2", "window-3", "settled"];
    try { execFileSync("python3", [path.join(root, "scripts/acceptance/summarize-gateway-heaps.py"), ...snapshots.sort((a,b) => order.indexOf(a.replace(".heapsnapshot", "")) - order.indexOf(b.replace(".heapsnapshot", ""))).map(n => path.join(privateDir,n)), "--output", path.join(out, "heap-census.json")], { stdio: "pipe" }); }
    catch (e) { summary.heapCensusError = e.message; summary.status = "FAIL"; process.exitCode = 1; }
  }
  fs.rmSync(privateDir, { recursive: true, force: true }); summary.privateMaterialRemoved = true;
  delete summary.privateProxy; delete summary.privateJwt;
  summary.finishedUtc = new Date().toISOString(); summary.totalElapsedSeconds = (performance.now() - start) / 1000;
  save("requests.json", records); save("faults.json", faults); save("background-errors.json", errors); save("summary.json", summary);
  console.log(JSON.stringify({ status: summary.status, jobs: accepted.length, seconds: summary.totalElapsedSeconds, databaseDropped: summary.databaseDropped, output: out }));
}
