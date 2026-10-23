import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { afterEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  listener: null as EventEmitter | null,
  claim: vi.fn(),
}));
vi.mock("../src/db", () => ({ pool: {
  connect: async () => {
    const client = new EventEmitter() as EventEmitter & { query: (text: string) => Promise<unknown>; release: () => void; processID: number };
    client.processID = 123;
    client.release = () => {};
    client.query = async (text: string) => {
      if (text.startsWith("LISTEN")) harness.listener = client;
      return { rows: text.includes("FROM tenants") ? [{ lifecycle: "active" }]
        : text.includes("FROM agents") ? [{ lifecycle: "active", lifecycle_revision: 0 }] : [] };
    };
    return client;
  },
} }));
vi.mock("../src/lib/agent-auth", () => ({ validateAgent: async () => ({ id: "agt_12345678", tenantId: "tenant-1", lifecycleRevision: 0 }) }));
vi.mock("../src/lib/ws-rate-limit", () => ({ reserveWsUpgradeAttempt: async () => ({ allowed: true }), recordWsUpgradeSuccess: async () => {} }));
vi.mock("../src/lib/metrics", () => ({ incrementMetric: async () => {} }));
vi.mock("../src/lib/job-delivery", () => ({
  claimJobForDelivery: harness.claim,
  markJobDelivered: vi.fn(), markJobDeliveryUnknown: vi.fn(), recordJobAck: vi.fn(), releaseUndeliveredClaim: vi.fn(),
}));
import { attachAgentWSS, getAgentWsCount } from "../src/server/ws";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); harness.claim.mockReset(); });

async function connectedAgent() {
  const server = createServer();
  const wss = attachAgentWSS(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/agent/ws`);
  await once(socket, "open");
  await vi.waitFor(() => expect(getAgentWsCount("agt_12345678")).toBe(1));
  cleanups.push(async () => {
    socket.terminate();
    for (const client of wss.clients) client.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return (id: string, tenantId = "tenant-1") => harness.listener!.emit("notification", {
    channel: "print_gateway_agent_jobs", payload: JSON.stringify({ jobId: id, agentId: "agt_12345678", tenantId }),
  });
}

it("bounds outstanding job notification claims and accepts work again after settlement", async () => {
  const pending: Array<() => void> = [];
  harness.claim.mockImplementation(() => new Promise(resolve => pending.push(() => resolve(null))));
  const notify = await connectedAgent();
  for (let index = 0; index < 200; index++) notify(`job-${index}`);
  await new Promise(resolve => setImmediate(resolve));
  expect(harness.claim.mock.calls.length).toBeLessThanOrEqual(16);
  expect(harness.claim.mock.calls.length).toBeGreaterThan(0);
  for (const resolve of pending.splice(0)) resolve();
  await new Promise(resolve => setImmediate(resolve));
  const previous = harness.claim.mock.calls.length;
  notify("job-after-settlement");
  await new Promise(resolve => setImmediate(resolve));
  expect(harness.claim.mock.calls.length).toBe(previous + 1);
  for (const resolve of pending.splice(0)) resolve();
});

it("coalesces duplicate notices while a claim is pending and still enforces tenant fencing", async () => {
  let settle!: () => void;
  harness.claim.mockImplementation(() => new Promise(resolve => { settle = () => resolve(null); }));
  const notify = await connectedAgent();
  notify("wrong-tenant", "tenant-other");
  for (let index = 0; index < 50; index++) notify("same-job");
  await new Promise(resolve => setImmediate(resolve));
  expect(harness.claim.mock.calls.map(call => call[0])).toEqual(["same-job"]);
  settle();
});
