/* Test-only preload. No listener or diagnostics endpoint is added to Gateway. */
const fs = require("node:fs");
const path = require("node:path");
const v8 = require("node:v8");
const { PerformanceObserver, performance, monitorEventLoopDelay } = require("node:perf_hooks");

const output = process.env.YASEIR_PROBE_OUTPUT;
const privateDir = process.env.YASEIR_PROBE_PRIVATE;
if (!output || !privateDir || typeof global.gc !== "function" || !process.send) {
  throw new Error("Memory probe requires explicit output/private paths, --expose-gc and parent IPC");
}
const start = performance.now();
let phase = "startup";
const gc = { count: 0, milliseconds: 0, byKind: {} };
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    const key = String(entry.detail.kind);
    gc.count += 1; gc.milliseconds += entry.duration;
    gc.byKind[key] = (gc.byKind[key] || 0) + 1;
  }
});
observer.observe({ entryTypes: ["gc"] });
const delay = monitorEventLoopDelay({ resolution: 20 }); delay.enable();
function sample(kind = "sample") {
  const pools = Object.values(require.cache).filter(m => /[/\\]src[/\\]db[/\\]index\.ts$/.test(m.filename))
    .map(m => m.exports.pool).filter(Boolean).map(p => ({ total: p.totalCount, idle: p.idleCount, waiting: p.waitingCount, max: p.options?.max }));
  const row = { kind, utc: new Date().toISOString(), elapsedMs: performance.now() - start, phase,
    pid: process.pid, memory: process.memoryUsage(), heap: v8.getHeapStatistics(),
    spaces: v8.getHeapSpaceStatistics(),
    gc: { count: gc.count, milliseconds: gc.milliseconds, byKind: { ...gc.byKind } },
    customServerPools: pools,
    activeResources: process.getActiveResourcesInfo().reduce((a, n) => (a[n] = (a[n] || 0) + 1, a), {}),
    eventLoopDelay: { meanMs: delay.mean / 1e6, maxMs: delay.max / 1e6, p99Ms: delay.percentile(99) / 1e6 },
    cpu: process.cpuUsage(), fileDescriptors: fs.readdirSync(`/proc/${process.pid}/fd`).length,
    host: { loadavg: fs.readFileSync("/proc/loadavg", "utf8").trim(), cgroupMemoryBytes: Number(fs.readFileSync("/sys/fs/cgroup/memory.current", "utf8")) } };
  fs.appendFileSync(output, JSON.stringify(row) + "\n", { mode: 0o600 });
  delay.reset();
  return row;
}
const timer = setInterval(sample, 1000); timer.unref();
process.on("message", async (message) => {
  if (message?.type === "phase") { phase = String(message.phase).slice(0, 40); return; }
  if (message?.type !== "checkpoint" || !/^[a-z0-9_-]+$/.test(message.name)) return;
  phase = `checkpoint-${message.name}`;
  const before = sample("before-forced-gc");
  global.gc(); await new Promise(setImmediate); global.gc(); await new Promise(setImmediate);
  const after = sample("after-forced-gc");
  let snapshot;
  if (message.snapshot) snapshot = v8.writeHeapSnapshot(path.join(privateDir, `${message.name}.heapsnapshot`));
  process.send?.({ type: "checkpoint", name: message.name, before, after, snapshot: snapshot ? path.basename(snapshot) : null });
});
process.on("exit", () => { clearInterval(timer); sample("exit"); observer.disconnect(); delay.disable(); });
