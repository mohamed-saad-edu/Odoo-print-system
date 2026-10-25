import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import sharp from "sharp";
import { createWorkloadCorpus, syntheticPrinterProfile, workloadAsset, workloadPayload, verifyPayloadIntegrity } from "../scripts/acceptance/gateway-soak-payloads.mjs";

const corpusPromise = createWorkloadCorpus();
const fixture = index => ({ printerId: `synthetic-printer-${index}`, installationId: "00000000-0000-4000-8000-000000000001", ...syntheticPrinterProfile(`synthetic-printer-${index}`, index, "2026-10-24T00:00:00.000Z") });

test("actual workload heartbeat supplies fresh exact shared-contract verification and preserves its execution binding", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict'; import fs from 'node:fs'; import vm from 'node:vm';
    import { randomUUID } from 'node:crypto';
    import { syntheticPrinterProfile } from './scripts/acceptance/gateway-soak-payloads.mjs';
    import { physicalPrinterIdentityKey } from './src/lib/physical-printer-identity.ts';
    import { validatePrinterOperationalVerification } from './src/lib/printer-operational-verification.ts';
    const source = fs.readFileSync('./scripts/acceptance/gateway-soak.mjs', 'utf8');
    const body = source.slice(source.indexOf('async function heartbeat('), source.indexOf('function consumeJob('));
    let time = Date.now(); const calls = [];
    class Clock extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } }
    const heartbeat = vm.runInNewContext(body + '\\nheartbeat', { assert, Date: Clock, randomUUID, checkpointBusy: false, stopping: false,
      physicalPrinterIdentityKey, validatePrinterOperationalVerification,
      expectStatus: result => assert.equal(result.status, 200),
      request: async (_route, options) => { calls.push(options.body.printers[0]); return { status: 200 }; } });
    for (let index = 0; index < 6; index++) {
      const f = { printerId: 'synthetic-bound-' + index, agentAuth: 'test-only', ...syntheticPrinterProfile('synthetic-bound-' + index, index) };
      await heartbeat(f); const first = calls.at(-1);
      const proof = first.capabilities.operational_verification;
      assert.equal(validatePrinterOperationalVerification(proof, first, new Date(time)).ok, true, 'fresh valid operational proof required');
      const expected = physicalPrinterIdentityKey(first).slice(3);
      assert.equal(proof.binding_digest, expected); assert.equal(proof.logical_queue_key, expected); assert.equal(f.bindingDigest, expected);
      assert.equal(proof.printer_id, f.printerId); assert.equal(proof.method, 'windows_queue');
      time += 20_000; await heartbeat(f); const second = calls.at(-1).capabilities.operational_verification;
      assert.notEqual(second.verified_at, proof.verified_at); assert.equal(second.binding_digest, expected);
      const before = calls.length; f.config = { ...f.config, spooler_name: f.config.spooler_name + '00' };
      await assert.rejects(heartbeat(f), /execution binding changed/); assert.equal(calls.length, before);
    }
    console.log('PASS');
  `], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
  assert.equal(output.trim(), "PASS");
});

test("actual synthetic consumer refuses missing or changed immutable binding before ACK or terminal report", async () => {
  const source = fs.readFileSync(new URL("../scripts/acceptance/gateway-soak.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("function consumeJob("), source.indexOf("async function pollConsumer("));
  const payload = { type: "raw", protocol: "raw", encoding: "base64", data: Buffer.from("synthetic receipt").toString("base64") };
  for (const binding of [undefined, "b".repeat(64), "a".repeat(64)]) {
    const errors = [], deliveries = new Map(), pendingConsumers = new Set(), terminal = new Map(); let reports = 0;
    const expectedPayloads = new Map([["printer-test:0", { format: "raw", decodedBytes: 17, sha256: createHash("sha256").update("synthetic receipt").digest("hex"), protocol: "raw" }]]);
    const consume = vm.runInNewContext(body + "\nconsumeJob", { assert, errors, deliveries, expectedPayloads, pendingConsumers, terminal, performance, phase: "test", verifyPayloadIntegrity,
      WebSocket: { OPEN: 1 }, expectStatus: result => result,
      request: async () => { reports++; return { status: 200, json: { physicalOutcome: "not_printed" } }; } });
    consume({ agentId: "agent-test", printerId: "printer-test", bindingDigest: "a".repeat(64) },
      { id: "job-test", claimToken: "claim-test", agentId: "agent-test", printerId: "printer-test", documentType: "operations-synthetic-0", bindingDigest: binding, payload }, "poll");
    await Promise.all([...pendingConsumers]);
    if (binding === "a".repeat(64)) {
      assert.equal(errors.length, 0); assert.equal(reports, 1); assert.equal(deliveries.size, 1);
    } else {
      assert.equal(reports, 0); assert.equal(deliveries.size, 0); assert.equal(errors.length, 1); assert.equal(errors[0].stage, "execution-binding");
    }
  }
});

test("the actual workload body covers RAW, JPEG and PDF with exact replay", async () => {
  const corpus = await corpusPromise, expectedPayloads = new Map();
  const source = fs.readFileSync(new URL("../scripts/acceptance/gateway-soak.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("function jobBody("), source.indexOf("async function heartbeat("));
  const jobBody = vm.runInNewContext(body + "\njobBody", { corpus, expectedPayloads, workloadAsset, workloadPayload, assert, maxAdmissions: 300, hash: value => createHash("sha256").update(value).digest("hex") });
  const counts = {};
  for (let index = 0; index < 300; index++) {
    const f = fixture(index % 6), first = jobBody(f, `operation-${index}`, index), replay = jobBody(f, `operation-${index}`, index);
    assert.equal(JSON.stringify(first), JSON.stringify(replay));
    counts[first.payload.type] = (counts[first.payload.type] || 0) + 1;
    verifyPayloadIntegrity(first.payload, expectedPayloads.get(`${f.printerId}:${index}`));
  }
  assert.deepEqual(counts, { raw: 150, image: 102, pdf: 48 });
  assert.throws(() => jobBody(fixture(0), "over-budget", 300), /admission budget exceeded/);
});

test("generated images fully decode at their declared widths and bounded long heights", async () => {
  const corpus = await corpusPromise;
  for (const asset of corpus.assets.filter(a => a.format === "image")) {
    const { info, data } = await sharp(asset.bytes).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, asset.width); assert.equal(info.height, asset.height);
    assert(info.width * info.height <= 40_000_000); assert(data.length >= info.width * info.height);
    if (asset.kind === "longJpegReceipt") assert(info.height >= info.width * 7);
  }
});

test("encoded image and PDF data do not collapse into repeated-byte placeholders", async () => {
  const corpus = await corpusPromise;
  for (const asset of corpus.assets.filter(a => a.format !== "raw")) {
    assert(asset.bytes.length > 16 * 1024, `${asset.id} must be a nontrivial document`);
    assert(asset.gzipRatio > .65, `${asset.id} is unexpectedly compressible: ${asset.gzipRatio}`);
    assert(asset.bytes.length <= 5 * 1024 * 1024);
  }
  assert(corpus.assets.find(a => a.id === "pdf-image-rich").bytes.length >= 1024 * 1024);
});

test("RAW receipts contain varied text and no printer peripheral control bytes", async () => {
  const corpus = await corpusPromise;
  const hashes = new Set();
  for (const asset of corpus.assets.filter(a => a.format === "raw")) {
    assert.match(asset.bytes.toString(), /^YASEIR SYNTHETIC RAW RECEIPT\n/);
    assert(!asset.bytes.some(byte => byte !== 10 && (byte < 32 || byte > 126)));
    assert(asset.bytes.length > 3000); hashes.add(asset.sha256);
  }
  assert.equal(hashes.size, 8);
});

test("PDF cross-reference offsets locate every declared object and the trailer", async () => {
  for (const asset of (await corpusPromise).assets.filter(a => a.format === "pdf")) {
    const text = asset.bytes.toString("latin1");
    const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
    assert.equal(text.slice(start, start + 5), "xref\n");
    const lines = text.slice(start).split("\n"), count = Number(lines[1].split(" ")[1]);
    for (let id = 1; id < count; id++) {
      const offset = Number(lines[id + 2].slice(0, 10));
      assert.equal(text.slice(offset, offset + `${id} 0 obj`.length), `${id} 0 obj`);
    }
    assert(text.includes(`/Count ${asset.pages} `));
    assert(text.includes(asset.media === "A4" ? "/MediaBox [0 0 595.276 841.89]" : "/MediaBox [0 0 419.528 595.276]"));
  }
});

test("current Gateway syntax and capability authorities admit every corpus/profile pairing", async () => {
  const corpus = await corpusPromise;
  const cases = [];
  for (let index = 0; index < 300; index++) {
    const f = fixture(index % 6), asset = workloadAsset(corpus, f, index);
    if (!cases.some(c => c.id === `${f.printerId}:${asset.id}`)) cases.push({ id: `${f.printerId}:${asset.id}`,
      printer: { id: f.printerId, connectionType: "spooler", protocol: "spooler", config: f.config, capabilities: f.capabilities }, payload: workloadPayload(asset, f) });
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "yaseir-soak-corpus-test-"));
  const casesPath = path.join(temporary, "cases.json"); fs.writeFileSync(casesPath, JSON.stringify(cases));
  let output;
  try { output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict'; import fs from 'node:fs';
    import { validatePrintJobPayload } from './src/lib/payload.ts';
    import { validatePayloadForPrinter } from './src/lib/printer-capability.ts';
    for (const entry of JSON.parse(fs.readFileSync(process.argv[1],'utf8'))) {
      const payload = validatePrintJobPayload(entry.payload);
      assert.equal(validatePayloadForPrinter(payload, entry.printer).ok, true, entry.id);
    }
    console.log('PASS');
  `, casesPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000, maxBuffer: 1024 * 1024 });
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  assert.equal(output.trim(), "PASS");
});

test("payload verification refuses corrupted bytes and stale geometry before outcome reporting", async () => {
  const corpus = await corpusPromise, f = fixture(0), asset = corpus.byId.get("jpeg-432-short"), payload = workloadPayload(asset, f);
  const expected = { format: asset.format, decodedBytes: asset.bytes.length, sha256: asset.sha256, protocol: undefined, geometryFingerprint: f.capabilities.geometry.config_fingerprint };
  const mutated = Buffer.from(asset.bytes); mutated[mutated.length - 12] ^= 1;
  assert.throws(() => verifyPayloadIntegrity({ ...payload, data: mutated.toString("base64") }, expected), /payload bytes changed/);
  assert.throws(() => verifyPayloadIntegrity({ ...payload, geometry_fingerprint: "b".repeat(64) }, expected), /geometry binding changed/);
  verifyPayloadIntegrity(payload, expected);
});
