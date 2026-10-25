import assert from "node:assert/strict";
import { fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { readCgroupMemoryBytes } = require("../scripts/acceptance/cgroup-memory.cjs");

test("memory probe handles cgroup v2, cgroup v1 and hosts without a memory cgroup", () => {
  const missing = () => { throw Object.assign(new Error("missing cgroup"), { code: "ENOENT" }); };
  assert.equal(readCgroupMemoryBytes((file) => file.endsWith("memory.current") ? "1024\n" : missing()), 1024);
  assert.equal(readCgroupMemoryBytes((file) => file.endsWith("memory.current") ? missing() : "4096\n"), 4096);
  assert.equal(readCgroupMemoryBytes(missing), null);
  assert.equal(readCgroupMemoryBytes(() => "max"), null);
  assert.equal(readCgroupMemoryBytes(() => { throw Object.assign(new Error("not permitted"), { code: "EACCES" }); }), null);
  assert.throws(() => readCgroupMemoryBytes(() => { throw Object.assign(new Error("I/O failure"), { code: "EIO" }); }), /I\/O failure/);
});

test("checkpoint IPC preserves the GC snapshots already recorded in JSONL", {
  timeout: 15_000,
  skip: process.platform !== "linux" && "The Gateway memory probe reads Linux /proc and cgroup counters",
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yaseir-probe-snapshot-"));
  const output = path.join(directory, "memory.jsonl");
  const childEntry = path.join(directory, "child.cjs");
  fs.writeFileSync(childEntry, `
    process.on("message", message => {
      if (message?.type === "finish") process.exit(0);
    });
    process.send({ type: "ready" });
  `);
  const child = fork(childEntry, [], {
    execArgv: ["--expose-gc", "--require", fileURLToPath(new URL("../scripts/acceptance/gateway-memory-probe.cjs", import.meta.url))],
    env: { ...process.env, YASEIR_PROBE_OUTPUT: output, YASEIR_PROBE_PRIVATE: directory },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let diagnostic = "";
  child.stderr.on("data", chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-16_384); });
  const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  function waitForMessage(type) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`Child did not send ${type}: ${diagnostic}`)), 10_000);
      const message = value => { if (value?.type === type) finish(undefined, value); };
      const error = cause => finish(cause);
      const exit = (code, signal) => finish(new Error(`Child exited before ${type}: code=${code}, signal=${signal}; ${diagnostic}`));
      function finish(cause, value) {
        clearTimeout(timer);
        child.off("message", message); child.off("error", error); child.off("exit", exit);
        if (cause) reject(cause); else resolve(value);
      }
      child.on("message", message); child.once("error", error); child.once("exit", exit);
    });
  }
  await waitForMessage("ready");
  const pending = waitForMessage("checkpoint");
  child.send({ type: "checkpoint", name: "snapshot-regression", snapshot: false });
  const checkpoint = await pending;
  const rows = fs.readFileSync(output, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const before = rows.find(row => row.kind === "before-forced-gc" && row.utc === checkpoint.before.utc);
  const after = rows.find(row => row.kind === "after-forced-gc" && row.utc === checkpoint.after.utc);
  assert(before && after, "The real child must write both checkpoint records");
  assert(after.gc.count > before.gc.count, "The regression must observe an actual GC entry between samples");
  assert((after.gc.byKind["4"] || 0) > (before.gc.byKind["4"] || 0), "The real forced collection must produce a major-GC observation");
  assert.deepEqual(checkpoint.before.gc, before.gc, "IPC must retain the original before-GC snapshot, including byKind");
  assert.deepEqual(checkpoint.after.gc, after.gc, "IPC must retain the recorded after-GC snapshot, including byKind");
  assert.equal(checkpoint.snapshot, null, "This regression must not create a heap snapshot");
  child.send({ type: "finish" });
  assert.deepEqual(await exited, { code: 0, signal: null });
});
