import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, request, type IncomingMessage } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import type { AddressInfo } from "node:net";
import vm from "node:vm";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { __getNotificationListenerPidForTests, attachAgentWSS, claimAndPushJobToAgent, getAgentWsCount } from "../src/server/ws";
import { applyMigrations, closePool, hasTestDatabase, insertQueuedJob, jobRow, pool, seedFixture } from "./helpers/pg";

const suite = describe.skipIf(!hasTestDatabase);

suite("Gateway shutdown with accepted WebSocket database work", () => {
  beforeAll(applyMigrations);
  afterAll(closePool);

  it("keeps security headers on authenticated malformed WebSocket protocol rejections", async () => {
    const fixture = await seedFixture();
    vi.stubEnv("NODE_ENV", "production");
    const server = createServer((_req, response) => response.writeHead(404).end());
    const wss = attachAgentWSS(server, { enableJobNotifications: false });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      for (const spec of [
        { name: "invalid-key", headers: { "sec-websocket-key": "invalid" }, status: 400 },
        { name: "invalid-version", headers: { "sec-websocket-version": "12" }, status: 400 },
        { name: "invalid-method", method: "POST", status: 405 },
        { name: "invalid-path", path: "/api/agent/ws-extra", status: 400 },
      ] as Array<{ name: string; headers?: Record<string, string>; status: number; method?: string; path?: string }>) {
        const response = await new Promise<{ status: number; headers: IncomingMessage["headers"] }>((resolve, reject) => {
          const req = request({ host: "127.0.0.1", port: (server.address() as AddressInfo).port,
            path: spec.path ?? "/api/agent/ws", method: spec.method ?? "GET", headers: {
              authorization: fixture.agentAuth, connection: "Upgrade", upgrade: "websocket",
              "sec-websocket-key": "c3ludGhldGljLWtleS0xNg==", "sec-websocket-version": "13", ...spec.headers,
            } }, res => { res.resume(); res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers })); });
          req.setTimeout(5000, () => req.destroy(new Error("WebSocket refusal deadline")));
          req.on("error", reject);
          req.on("upgrade", (_res, socket) => { socket.destroy(); reject(new Error("Malformed upgrade was accepted")); });
          req.end();
        });
        expect(response.status, spec.name).toBe(spec.status);
        expect(response.headers["x-content-type-options"], spec.name).toBe("nosniff");
        expect(response.headers["strict-transport-security"], spec.name).toBe("max-age=31536000; includeSubDomains");
        expect(response.headers["cross-origin-opener-policy"], spec.name).toBe("same-origin");
        expect(response.headers["cache-control"], spec.name).toBe("no-store");
        if (spec.name === "invalid-version") expect(response.headers["sec-websocket-version"]).toBe("13, 8");
        await expect.poll(() => getAgentWsCount(fixture.agentId)).toBe(0);
      }
    } finally {
      for (const client of wss.clients) client.terminate();
      await wss.drain();
      await new Promise<void>(resolve => server.close(() => resolve()));
      vi.unstubAllEnvs();
    }
  });

  it("sends common production security headers on an authenticated101 without changing the WebSocket protocol", async () => {
    const fixture = await seedFixture();
    vi.stubEnv("NODE_ENV", "production");
    const server = createServer((_req, response) => response.writeHead(404).end());
    const wss = attachAgentWSS(server, { enableJobNotifications: false });
    wss.on("connection", (client) => client.send("synthetic-header-probe"));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/agent/ws`, {
      headers: { authorization: fixture.agentAuth },
    });
    const upgraded = once(socket, "upgrade");
    const opened = once(socket, "open");
    const message = once(socket, "message");
    try {
      const [response] = await upgraded as [IncomingMessage];
      await opened;
      expect(response.statusCode).toBe(101);
      expect(response.headers.upgrade).toBe("websocket");
      expect(response.headers.connection?.toLowerCase()).toBe("upgrade");
      expect(response.headers["sec-websocket-accept"]).toBeTypeOf("string");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
      expect(response.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(response.headers["x-frame-options"]).toBe("DENY");
      expect(response.headers["cross-origin-opener-policy"]).toBe("same-origin");
      expect(response.headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=(), payment=()");
      expect((await message)[0].toString()).toBe("synthetic-header-probe");
      await expect.poll(() => getAgentWsCount(fixture.agentId)).toBe(1);
    } finally {
      socket.terminate();
      for (const client of wss.clients) client.terminate();
      await wss.drain();
      await new Promise<void>(resolve => server.close(() => resolve()));
      vi.unstubAllEnvs();
    }
  });

  it("persists an accepted ACK before the actual shutdown function ends PostgreSQL", async () => {
    const fixture = await seedFixture();
    const server = createServer((_req, response) => response.writeHead(404).end());
    const wss = attachAgentWSS(server, { enableJobNotifications: false });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/agent/ws`, {
      headers: { authorization: fixture.agentAuth },
    });
    const blocker = await pool().connect();
    let lockHeld = false;
    const shutdownTimers = new Set<ReturnType<typeof setTimeout>>();
    const events: string[] = [];
    let exited!: (code: number) => void;
    const exit = new Promise<number>(resolve => { exited = resolve; });
    try {
      await once(socket, "open");
      await expect.poll(() => getAgentWsCount(fixture.agentId)).toBe(1);
      await insertQueuedJob(fixture, "job_shutdown_ack");
      const message = once(socket, "message");
      expect(await claimAndPushJobToAgent({ id: "job_shutdown_ack", agentId: fixture.agentId })).toBe("delivered");
      const [data] = await message;
      const { job } = JSON.parse(data.toString());

      await blocker.query("BEGIN");
      lockHeld = true;
      await blocker.query("SELECT id FROM print_jobs WHERE id = $1 FOR UPDATE", [job.id]);
      socket.send(JSON.stringify({ type: "job_ack", jobId: job.id, claimToken: job.claimToken }));
      await expect.poll(async () => {
        const waiting = await pool().query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE 'update "print_jobs" set "acked_at"%'`);
        return waiting.rows[0].n;
      }, { timeout: 4_000 }).toBe(1);

      // Execute the real server shutdown function with the actual WSS and HTTP
      // server. The pool boundary records its call; the real database remains
      // available so the test can release the held row lock and inspect ACKs.
      const source = readFileSync("server.ts", "utf8");
      const start = source.indexOf("function shutdown(signal: string): void {");
      const end = source.indexOf('\nprocess.on("SIGTERM"', start);
      const wssClosed = once(wss, "close");
      vm.runInNewContext(stripTypeScriptTypes(source.slice(start, end)) + '\nshutdown("SIGTERM");', {
        shuttingDown: false,
        agentWss: wss,
        httpServer: server,
        maintenanceTasks: new Set(),
        SHUTDOWN_DRAIN_TIMEOUT_MS: 10_000,
        logInfo() {},
        logError(...args: unknown[]) { events.push(`error:${String(args[0])}`); },
        flushAuthorizationDenials() { events.push("authorization-denials-flushed"); },
        setTimeout(callback: () => void, milliseconds: number) {
          const timer = setTimeout(callback, milliseconds); shutdownTimers.add(timer); return timer;
        },
        clearTimeout,
        app: { async close() {} },
        pool: { async end() { events.push("pool-ended"); } },
        process: { exit(code: number) { events.push(`exit-${code}`); exited(code); } },
      });
      await wssClosed;
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(events, "An accepted ACK still holds a pending database write").not.toContain("pool-ended");
      await blocker.query("COMMIT");
      lockHeld = false;
      expect(await exit).toBe(0);
      expect((await jobRow(job.id)).acked_at).not.toBeNull();
      expect(events).toEqual(["authorization-denials-flushed", "pool-ended", "exit-0"]);
    } finally {
      if (lockHeld) await blocker.query("ROLLBACK");
      blocker.release();
      for (const timer of shutdownTimers) clearTimeout(timer);
      socket.terminate();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("finishes an accepted notification claim before reporting the WSS drained", async () => {
    const fixture = await seedFixture();
    const server = createServer((_req, response) => response.writeHead(404).end());
    const wss = attachAgentWSS(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/agent/ws`, {
      headers: { authorization: fixture.agentAuth },
    });
    const blocker = await pool().connect();
    let lockHeld = false;
    let drained = false;
    let drain: Promise<void> | undefined;
    try {
      await once(socket, "open");
      await expect.poll(() => getAgentWsCount(fixture.agentId)).toBe(1);
      await expect.poll(__getNotificationListenerPidForTests).toBeTypeOf("number");
      await blocker.query("BEGIN");
      lockHeld = true;
      await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`print_jobs:agent:${fixture.agentId}`]);
      await insertQueuedJob(fixture, "job_shutdown_notification");
      await expect.poll(async () => {
        const waiting = await pool().query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%pg_advisory_xact_lock%'`);
        return waiting.rows[0].n;
      }, { timeout: 4_000 }).toBe(1);
      const closed = once(wss, "close");
      drain = wss.drain().then(() => { drained = true; });
      await closed;
      // The LISTEN connection is released independently of the pending claim;
      // this barrier makes the pre-fix early drain deterministic.
      await expect.poll(__getNotificationListenerPidForTests).toBeNull();
      const beforeUnlock = await Promise.race([
        drain.then(() => "drained"),
        new Promise<string>(resolve => setTimeout(() => resolve("waiting"), 100)),
      ]);
      expect(beforeUnlock, "A notified claim is still waiting for its advisory lock").toBe("waiting");
      expect(drained).toBe(false);
      await blocker.query("COMMIT");
      lockHeld = false;
      await drain;
      const row = await jobRow("job_shutdown_notification");
      expect(row.status).toBe("queued");
      expect(row.claim_token).toBeNull();
      expect(row.delivery_attempts).toBe(1);
      expect(row.delivered_at).toBeNull();
    } finally {
      if (lockHeld) await blocker.query("ROLLBACK");
      blocker.release();
      await drain;
      socket.terminate();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
