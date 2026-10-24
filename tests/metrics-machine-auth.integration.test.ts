import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations, closePool, hasTestDatabase, pool, truncateAll } from "./helpers/pg";
import { pool as applicationPool } from "../src/db";
import { __clearSecretCacheForTests } from "../src/lib/runtime-secret";
import { createVerifiedPlatformPair } from "./helpers/platform-session";
import { getWorkerSchema } from "../src/lib/worker-schema";
import { GET as metrics } from "../src/app/api/metrics/route";
import { GET as platformMe } from "../src/app/api/platform/auth/me/route";
import { GET as workspaceMe } from "../src/app/api/auth/me/route";
import { GET as settings, PATCH as changeSettings } from "../src/app/api/settings/route";
import { POST as deleteTenant } from "../src/app/api/platform/tenants/[id]/delete/route";
import { POST as agentHeartbeat } from "../src/app/api/agent/heartbeat/route";

const origin = "http://localhost:3000";
let directory = "";
let file = "";
let collector = "";
function request(path = "/api/metrics", authorization: string | null = `Bearer ${collector}`, extra: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, { headers: { ...(authorization === null ? {} : { authorization }), ...extra } });
}

describe.skipIf(!hasTestDatabase)("dedicated metrics machine credential", () => {
  beforeAll(async () => { await applyMigrations(); });
  beforeEach(async () => {
    for (const name of ["GATEWAY_JWT_SECRET", "TRUST_PROXY_SECRET"]) {
      vi.stubEnv(name, randomBytes(32).toString("hex"));
      vi.stubEnv(`${name}_FILE`, "");
    }
    vi.stubEnv("APP_BASE_URL", origin);
    vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("RESEND_API_KEY_FILE", "");
    __clearSecretCacheForTests();
    directory = mkdtempSync(join(tmpdir(), "yaseir-metrics-integration-"));
    file = join(directory, "collector-token");
    collector = randomBytes(32).toString("hex");
    writeFileSync(file, collector, { mode: 0o600 });
    vi.stubEnv("METRICS_SCRAPE_TOKEN_FILE", file);
    await truncateAll();
    await pool().query("INSERT INTO users(id,email,password_hash,email_verified_at,is_platform_owner) VALUES('metrics-owner','metrics-owner@example.test','unused',clock_timestamp(),true)");
    await pool().query("INSERT INTO tenants(id,name) VALUES('metrics-tenant','Synthetic metrics tenant')");
  });
  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
    vi.unstubAllEnvs(); __clearSecretCacheForTests();
  });
  afterAll(async () => {
    try {
      await applicationPool.end();
      const schema = getWorkerSchema();
      if (!schema || !/^test_[a-z0-9_]+$/i.test(schema)) throw new Error("Expected isolated metrics test schema");
      await pool().query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally { await closePool(); }
  });

  it("admits only the configured collector to an actual PostgreSQL metrics scrape", async () => {
    const response = await metrics(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain; version=0.0.4");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("print_jobs_queue_depth 0");
    const rejected = await metrics(request("/api/metrics", `Bearer ${randomBytes(32).toString("hex")}`));
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("cache-control")).toBe("no-store");
  });

  it("is disabled by default and does not accept inline or query-string credentials", async () => {
    vi.stubEnv("METRICS_SCRAPE_TOKEN_FILE", "");
    vi.stubEnv("METRICS_SCRAPE_TOKEN", collector);
    expect((await metrics(request())).status).toBe(401);
    vi.stubEnv("METRICS_SCRAPE_TOKEN_FILE", file);
    expect((await metrics(request(`/api/metrics?token=${collector}`, null))).status).toBe(401);
    expect((await metrics(request("/api/metrics?probe=1"))).status).toBe(401);
    expect((await metrics(request("/api/metrics/"))).status).toBe(401);
  });

  it("preserves real password-verified owner cookie and JWT bearer admission", async () => {
    const pair = await createVerifiedPlatformPair("metrics-owner", "metrics-owner@example.test");
    const cookie = `plt_session=${pair.accessToken}`;
    expect((await metrics(request("/api/metrics", null, { cookie }))).status).toBe(200);
    expect((await metrics(request("/api/metrics", `Bearer ${pair.accessToken}`, { cookie: "plt_session=stale" }))).status).toBe(200);
    vi.stubEnv("METRICS_SCRAPE_TOKEN_FILE", "");
    expect((await metrics(request("/api/metrics", null, { cookie }))).status).toBe(200);
    expect((await metrics(request())).status).toBe(401);
  });

  it("never downgrades an invalid explicit Authorization header to an ambient owner cookie", async () => {
    const pair = await createVerifiedPlatformPair("metrics-owner", "metrics-owner@example.test");
    const cookie = `plt_session=${pair.accessToken}`;
    for (const authorization of ["", "Bearer", "Bearer ", "Basic invalid", `Bearer ${randomBytes(32).toString("hex")}`, `Bearer ${collector}, Bearer ${collector}`, `Bearer ${collector} trailing`]) {
      const response = await metrics(request("/api/metrics", authorization, { cookie }));
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    const headers = new Headers({ cookie });
    headers.append("authorization", `Bearer ${collector}`); headers.append("authorization", `Bearer ${collector}`);
    expect((await metrics(new Request(`${origin}/api/metrics`, { headers }))).status).toBe(401);
    expect((await metrics(request("/api/metrics", null, { cookie }))).status).toBe(200);
  });

  it("invalidates old authority immediately after same-size same-mtime rotation, deletion and disabling", async () => {
    expect((await metrics(request())).status).toBe(200);
    const before = statSync(file);
    const replacement = randomBytes(32).toString("hex");
    writeFileSync(file, replacement); utimesSync(file, before.atime, before.mtime);
    expect(statSync(file).size).toBe(before.size);
    expect((await metrics(request())).status).toBe(401);
    expect((await metrics(request("/api/metrics", `Bearer ${replacement}`))).status).toBe(200);
    unlinkSync(file);
    const unavailable = await metrics(request("/api/metrics", `Bearer ${replacement}`));
    expect(unavailable.status).toBe(503); expect(unavailable.headers.get("cache-control")).toBe("no-store");
    vi.stubEnv("METRICS_SCRAPE_TOKEN_FILE", "");
    expect((await metrics(request("/api/metrics", `Bearer ${replacement}`))).status).toBe(401);
  });

  it("fails closed on malformed or missing configured custody without echoing values, even for an owner", async () => {
    const pair = await createVerifiedPlatformPair("metrics-owner", "metrics-owner@example.test");
    const malformed = `private-invalid-${randomBytes(12).toString("hex")}`;
    writeFileSync(file, malformed);
    const identities: Record<string, string>[] = [{}, { cookie: `plt_session=${pair.accessToken}` }];
    for (const headers of identities) {
      const response = await metrics(request("/api/metrics", null, headers));
      expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.text(); expect(body).not.toContain(malformed); expect(body).not.toContain(file);
    }
    unlinkSync(file);
    expect((await metrics(request())).status).toBe(503);
  });

  it.each(["GATEWAY_JWT_SECRET", "TRUST_PROXY_SECRET"])("rejects opposite-case reuse of %s", async name => {
    writeFileSync(file, process.env[name]!.toUpperCase());
    const response = await metrics(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(process.env[name]!);
  });

  it("does not authorize platform, workspace, settings or Agent routes and cannot mutate tenant data", async () => {
    expect((await platformMe(request("/api/platform/auth/me"))).status).toBe(401);
    expect((await workspaceMe(request("/api/auth/me"))).status).toBe(401);
    expect((await settings(request("/api/settings"))).status).toBe(401);
    const headers = { authorization: `Bearer ${collector}`, origin, "content-type": "application/json" };
    expect((await changeSettings(new Request(`${origin}/api/settings`, { method: "PATCH", headers, body: JSON.stringify({ name: "Unauthorized rename" }) }))).status).toBe(401);
    expect((await deleteTenant(new Request(`${origin}/api/platform/tenants/metrics-tenant/delete`, { method: "POST", headers, body: JSON.stringify({ confirmed: true }) }), { params: Promise.resolve({ id: "metrics-tenant" }) })).status).toBe(401);
    expect((await agentHeartbeat(new Request(`${origin}/api/agent/heartbeat`, { method: "POST", headers, body: JSON.stringify({ status: "online", printers: [] }) }))).status).toBe(401);
    expect((await pool().query("SELECT name,lifecycle FROM tenants WHERE id='metrics-tenant'")).rows).toEqual([{ name: "Synthetic metrics tenant", lifecycle: "active" }]);
    expect((await pool().query("SELECT count(*)::int AS n FROM refresh_tokens")).rows[0].n).toBe(0);
    expect((await pool().query("SELECT count(*)::int AS n FROM audit_events")).rows[0].n).toBe(0);
  });

  it("returns generic no-store503 when the real PostgreSQL collector cannot complete", async () => {
    await pool().query("ALTER TABLE print_jobs RENAME TO metrics_unavailable_jobs");
    try {
      // A worker search_path includes public; leaving the name absent would
      // silently query that independent schema. An incompatible local view
      // makes the real collector fail deterministically in this worker only.
      await pool().query("CREATE VIEW print_jobs AS SELECT 1::integer AS status");
      const response = await metrics(request());
      expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("Metrics temporarily unavailable\n");
    } finally {
      await pool().query("DROP VIEW IF EXISTS print_jobs");
      await pool().query("ALTER TABLE metrics_unavailable_jobs RENAME TO print_jobs");
    }
  });
});
