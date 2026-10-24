import type * as PasswordScreeningModule from "../src/lib/password-screening";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations, closePool, hasTestDatabase, pool, truncateAll } from "./helpers/pg";
import { hashPassword, hashToken } from "../src/lib/password";
import { POST as beginLogin } from "../src/app/api/auth/login/route";
import { POST as refresh } from "../src/app/api/auth/refresh/route";
import { GET as me } from "../src/app/api/auth/me/route";
import { validateWorkspaceManager, verifyWorkspaceToken } from "../src/lib/manager-auth";
import { requireManagerActorInTransaction } from "../src/lib/manager-mutation-authorization";
import { requireTeamActorInTransaction } from "../src/lib/team-authorization";
import { requireActiveTenantInTransaction } from "../src/lib/tenant-guard";
import { db } from "../src/db";
import { POST as beginConfirmation } from "../src/app/api/auth/reauth/password/route";
import { POST as activity } from "../src/app/api/auth/activity/route";
import { POST as selectTenant } from "../src/app/api/auth/select-tenant/route";
import { POST as managerLogin } from "../src/app/api/auth/manager/login/route";
import { POST as logout } from "../src/app/api/auth/logout/route";
import { PATCH as updateSettings } from "../src/app/api/settings/route";
import { rotateRefreshToken } from "../src/lib/session-tokens";
import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { POST as resetPassword } from "../src/app/api/auth/reset-password/route";
import { POST as cutoverOdoo } from "../src/app/api/odoo/installations/cutover/route";
import { POST as resolveOdoo } from "../src/app/api/odoo/installations/resolutions/route";
import { POST as createAgent } from "../src/app/api/agents/route";
import * as databaseClock from "../src/lib/database-clock";

// This suite exercises real password reset/session transactions. Only the
// external breach service is deterministic; it does not supply authentication.
vi.mock("../src/lib/password-screening", async importActual => ({
  ...await importActual<typeof PasswordScreeningModule>(),
  screenNewPassword: vi.fn(async () => "acceptable"),
}));

async function waitForBlockedBy(pid: number) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const result = await pool().query("SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) LIMIT 1", [pid]);
    if (result.rows.length) return Number(result.rows[0].pid);
    if (Date.now() >= deadline) throw new Error("Expected database lock boundary was not reached");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

const password = "workspace-security-regression-93!";
let passwordHash: string;
const cookie = (response: Response, name: string) => response.headers.getSetCookie().find(value => value.startsWith(`${name}=`))?.split(";")[0].slice(name.length + 1) ?? "";
const req = (path: string, access: string, body?: unknown, refreshToken?: string) => new Request(`http://localhost:3000${path}`, {
  method: body === undefined ? "GET" : "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", cookie: `cust_session=${access}${refreshToken ? `; cust_refresh=${refreshToken}` : ""}` },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
async function login(request: Request) {
  return beginLogin(request);
}
async function confirmPassword(request: Request) {
  return beginConfirmation(request);
}
async function session() {
  const response = await login(req("/api/auth/login", "", { email: "u@example.test", password, tenantId: "a" }));
  expect(response.status).toBe(200);
  const access = cookie(response, "cust_session"), refreshToken = cookie(response, "cust_refresh");
  return { access, refreshToken, claims: (await validateWorkspaceManager(req("/api/auth/me", access)))! };
}

describe.skipIf(!hasTestDatabase)("workspace persisted activity and fresh-password authority", () => {
  beforeAll(async () => {
    process.env.GATEWAY_JWT_SECRET = "workspace-security-tests-secret-at-least-32";
    process.env.APP_BASE_URL = "http://localhost:3000";
    await applyMigrations(); passwordHash = await hashPassword(password);
  });
  beforeEach(async () => {
    await truncateAll();
    await pool().query("INSERT INTO tenants(id,name) VALUES ('a','A'),('b','B')");
    await pool().query("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES ('u','u@example.test',$1,clock_timestamp())", [passwordHash]);
    await pool().query("INSERT INTO tenant_users(user_id,tenant_id,role) VALUES ('u','a','owner'),('u','b','owner')");
  });
  afterAll(closePool);
  afterEach(() => vi.unstubAllEnvs());

  it("reports fresh login assurance without storing passwords or bearer credentials", async () => {
    const current = await session();
    const { GET } = await import("../src/app/api/auth/reauth/status/route");
    const response = await GET(req("/api/auth/reauth/status", current.access));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ kind: "customer", reauthenticationRequired: false });
    expect(Date.parse(body.stepUpExpiresAt)).toBeLessThan(Date.parse(body.idleExpiresAt));
    expect(Date.parse(body.idleExpiresAt)).toBeLessThan(Date.parse(body.absoluteExpiresAt));
    expect(JSON.stringify(body)).not.toMatch(/credentialVersion|passwordHash|accessToken|refreshToken/);
  });

  it("rejects an expired idle session at access, refresh and both commit guards", async () => {
    const current = await session();
    await pool().query("UPDATE workspace_session_security SET created_at=created_at-interval '1 hour', password_verified_at=password_verified_at-interval '1 hour', last_seen_at=clock_timestamp()-interval '31 minutes' WHERE family_id=$1", [current.claims.familyId]);
    expect(await verifyWorkspaceToken(current.access)).toBeNull();
    expect((await refresh(req("/api/auth/refresh", current.access, {}, current.refreshToken))).status).toBe(401);
    await expect(db.transaction(async tx => { await requireActiveTenantInTransaction(tx, "a"); await requireManagerActorInTransaction(tx, current.claims, "integrations.manage"); })).rejects.toThrow();
    await expect(db.transaction(tx => requireTeamActorInTransaction(tx, current.claims))).rejects.toThrow();
  });

  it("background reads, probes, status and refresh never update user activity", async () => {
    const current = await session();
    await pool().query("UPDATE workspace_session_security SET created_at=created_at-interval '15 minutes', password_verified_at=password_verified_at-interval '15 minutes', last_seen_at=clock_timestamp()-interval '10 minutes' WHERE family_id=$1", [current.claims.familyId]);
    const before = (await pool().query("SELECT last_seen_at FROM workspace_session_security WHERE family_id=$1", [current.claims.familyId])).rows[0].last_seen_at;
    expect((await me(req("/api/auth/me", current.access))).status).toBe(200);
    const { GET } = await import("../src/app/api/auth/reauth/status/route");
    expect((await GET(req("/api/auth/reauth/status", current.access))).status).toBe(200);
    expect((await refresh(req("/api/auth/refresh", current.access, {}, current.refreshToken))).status).toBe(200);
    expect((await pool().query("SELECT last_seen_at FROM workspace_session_security WHERE family_id=$1", [current.claims.familyId])).rows[0].last_seen_at).toEqual(before);
  });

  it("requires fresh password for sensitive mutations while normal reads remain usable", async () => {
    const current = await session();
    await pool().query("UPDATE workspace_session_security SET created_at=created_at-interval '10 minutes', password_verified_at=clock_timestamp()-interval '6 minutes' WHERE family_id=$1", [current.claims.familyId]);
    expect(await verifyWorkspaceToken(current.access)).not.toBeNull();
    await expect(db.transaction(async tx => { await requireActiveTenantInTransaction(tx, "a"); await requireManagerActorInTransaction(tx, current.claims, "tenant.read"); })).resolves.toBeUndefined();
    await expect(db.transaction(async tx => { await requireActiveTenantInTransaction(tx, "a"); await requireManagerActorInTransaction(tx, current.claims, "integrations.manage"); })).rejects.toMatchObject({ code: "WORKSPACE_REAUTHENTICATION_REQUIRED" });
    await expect(db.transaction(tx => requireTeamActorInTransaction(tx, current.claims))).rejects.toMatchObject({ code: "WORKSPACE_REAUTHENTICATION_REQUIRED" });
  });

  it("fresh password reauth rotates tokens and updates proof without extending absolute expiry", async () => {
    const current = await session();
    const before = (await pool().query("SELECT expires_at FROM workspace_session_security WHERE family_id=$1", [current.claims.familyId])).rows[0].expires_at;
    const POST = confirmPassword;
    expect((await POST(req("/api/auth/reauth/password", current.access, { password: "wrong" }))).status).toBe(403);
    const response = await POST(req("/api/auth/reauth/password", current.access, { password }));
    expect(response.status).toBe(200);
    const replacement = cookie(response, "cust_session");
    expect(replacement).not.toBe(current.access);
    expect(await verifyWorkspaceToken(current.access)).toBeNull();
    expect(await verifyWorkspaceToken(replacement)).toMatchObject({ familyId: current.claims.familyId });
    expect((await pool().query("SELECT expires_at FROM workspace_session_security WHERE family_id=$1", [current.claims.familyId])).rows[0].expires_at).toEqual(before);
  });

  it("activity extends only a live session's idle deadline and never its password proof", async () => {
    const current = await session();
    const { POST } = await import("../src/app/api/auth/activity/route");
    await pool().query("UPDATE workspace_session_security SET created_at=created_at-interval '10 minutes', password_verified_at=password_verified_at-interval '10 minutes', last_seen_at=clock_timestamp()-interval '5 minutes' WHERE family_id=$1", [current.claims.familyId]);
    const before = (await pool().query("SELECT password_verified_at,last_seen_at FROM workspace_session_security WHERE family_id=$1", [current.claims.familyId])).rows[0];
    expect((await POST(req("/api/auth/activity", current.access, {}))).status).toBe(204);
    const after = (await pool().query("SELECT password_verified_at,last_seen_at FROM workspace_session_security WHERE family_id=$1", [current.claims.familyId])).rows[0];
    expect(after.password_verified_at).toEqual(before.password_verified_at);
    expect(after.last_seen_at.getTime()).toBeGreaterThan(before.last_seen_at.getTime());
    await pool().query("UPDATE workspace_session_security SET created_at=created_at-interval '1 hour', password_verified_at=password_verified_at-interval '1 hour', last_seen_at=clock_timestamp()-interval '31 minutes' WHERE family_id=$1", [current.claims.familyId]);
    expect((await POST(req("/api/auth/activity", current.access, {}))).status).toBe(401);
  });

  it("returns the usable step-up contract from a real privileged mutation without applying it", async () => {
    await pool().query("UPDATE tenant_users SET role='owner' WHERE user_id='u' AND tenant_id='a'");
    const current = await session();
    await pool().query("UPDATE workspace_session_security SET created_at=created_at-interval '10 minutes', password_verified_at=clock_timestamp()-interval '5 minutes' WHERE family_id=$1", [current.claims.familyId]);
    const mutation = (access: string) => new Request("http://localhost:3000/api/settings", { method: "PATCH", headers: { origin: "http://localhost:3000", cookie: `cust_session=${access}`, "content-type": "application/json" }, body: JSON.stringify({ name: "Confirmed name" }) });
    const denied = await updateSettings(mutation(current.access));
    expect(denied.status).toBe(403);
    expect(denied.headers.get("X-Yaseir-Reauthentication")).toBe("required");
    expect(await denied.json()).toMatchObject({ code: "WORKSPACE_REAUTHENTICATION_REQUIRED", reauthenticationUrl: "/settings?reauth=1" });
    expect((await pool().query("SELECT name FROM tenants WHERE id='a'")).rows[0].name).toBe("A");
    const confirmed = await confirmPassword(req("/api/auth/reauth/password", current.access, { password }));
    expect(confirmed.status).toBe(200);
    expect((await updateSettings(mutation(cookie(confirmed, "cust_session")))).status).toBe(200);
    expect((await pool().query("SELECT name FROM tenants WHERE id='a'")).rows[0].name).toBe("Confirmed name");
  });

  it("fails closed on absent policy and future activity or proof without backfilling", async () => {
    for (const corruption of ["DELETE FROM workspace_session_security WHERE family_id=$1",
      "UPDATE workspace_session_security SET last_seen_at=clock_timestamp()+interval '1 minute' WHERE family_id=$1",
      "UPDATE workspace_session_security SET password_verified_at=clock_timestamp()+interval '1 minute' WHERE family_id=$1"]) {
      const current = await session();
      await pool().query(corruption, [current.claims.familyId]);
      expect(await verifyWorkspaceToken(current.access)).toBeNull();
      expect((await activity(req("/api/auth/activity", current.access, {}))).status).toBe(401);
      expect((await rotateRefreshToken("customer", current.refreshToken)).status).toBe("invalid");
    }
  });

  it("rejects the exact thirty-minute idle boundary and an elapsed absolute deadline", async () => {
    for (const update of ["created_at=created_at-interval '1 hour',password_verified_at=password_verified_at-interval '1 hour',last_seen_at=clock_timestamp()-interval '30 minutes'",
      "created_at=created_at-interval '1 minute',password_verified_at=password_verified_at-interval '1 minute',last_seen_at=last_seen_at-interval '1 minute',expires_at=clock_timestamp()-interval '1 second'"]) {
      const current = await session();
      await pool().query(`UPDATE workspace_session_security SET ${update} WHERE family_id=$1`, [current.claims.familyId]);
      expect(await verifyWorkspaceToken(current.access)).toBeNull();
      expect((await confirmPassword(req("/api/auth/reauth/password", current.access, { password }))).status).toBe(401);
    }
  });

  it("inherits stale password proof and the original absolute deadline on a workspace switch", async () => {
    const current = await session();
    await pool().query("UPDATE workspace_session_security SET created_at=created_at-interval '10 minutes',password_verified_at=password_verified_at-interval '6 minutes',expires_at=clock_timestamp()+interval '2 hours' WHERE family_id=$1", [current.claims.familyId]);
    const before = (await pool().query("SELECT created_at,password_verified_at,expires_at FROM workspace_session_security WHERE family_id=$1", [current.claims.familyId])).rows[0];
    const switched = await selectTenant(req("/api/auth/select-tenant", current.access, { tenantId: "b" }));
    expect(switched.status).toBe(200);
    const claims = (await verifyWorkspaceToken(cookie(switched, "cust_session")))!;
    expect(claims.tenantId).toBe("b");
    expect(claims.familyId).not.toBe(current.claims.familyId);
    expect((await pool().query("SELECT created_at,password_verified_at,expires_at FROM workspace_session_security WHERE family_id=$1", [claims.familyId])).rows[0]).toEqual(before);
    await expect(db.transaction(async tx => { await requireActiveTenantInTransaction(tx, "b"); await requireManagerActorInTransaction(tx, claims, "integrations.manage"); })).rejects.toMatchObject({ code: "WORKSPACE_REAUTHENTICATION_REQUIRED" });
    expect(await verifyWorkspaceToken(current.access)).toBeNull();
  });

  it("checks inactivity again after waiting for the family lock, before recording activity", async () => {
    const current = await session(), blocker = await pool().connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query("SELECT pg_backend_pid() n")).rows[0].n;
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [current.claims.familyId]);
      pending = activity(req("/api/auth/activity", current.access, {}));
      await waitForBlockedBy(pid);
      await blocker.query("UPDATE workspace_session_security SET created_at=created_at-interval '1 hour',password_verified_at=password_verified_at-interval '1 hour',last_seen_at=clock_timestamp()-interval '31 minutes' WHERE family_id=$1", [current.claims.familyId]);
      await blocker.query("COMMIT");
      expect((await pending).status).toBe(401);
      expect(await verifyWorkspaceToken(current.access)).toBeNull();
    } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending; }
  });

  it("permits one concurrent confirmation and rejects the replaced access at activity", async () => {
    const current = await session();
    const responses = await Promise.all([1,2].map(() => confirmPassword(req("/api/auth/reauth/password", current.access, { password }))));
    expect(responses.map(r => r.status).sort()).toEqual([200,401]);
    expect((await activity(req("/api/auth/activity", current.access, {}))).status).toBe(401);
    expect((await pool().query("SELECT id FROM refresh_tokens WHERE family_id=$1 AND revoked_at IS NULL", [current.claims.familyId])).rows).toHaveLength(1);
  });

  it("keeps one usable successor when confirmation races refresh, then logout terminates it", async () => {
    const current = await session();
    const [confirmed, renewed] = await Promise.all([confirmPassword(req("/api/auth/reauth/password", current.access, { password })), rotateRefreshToken("customer", current.refreshToken)]);
    expect(confirmed.status).toBe(200);
    const successor = cookie(confirmed, "cust_session");
    expect(await verifyWorkspaceToken(successor)).not.toBeNull();
    if (renewed.status === "rotated") expect(await verifyWorkspaceToken(renewed.pair.accessToken)).toBeNull();
    else expect(renewed.status).toBe("invalid");
    const [otherConfirmation, signedOut] = await Promise.all([confirmPassword(req("/api/auth/reauth/password", successor, { password })), logout(req("/api/auth/logout", successor, {}))]);
    expect(signedOut.status).toBe(200);
    expect([200,401]).toContain(otherConfirmation.status);
    expect((await pool().query("SELECT id FROM refresh_tokens WHERE family_id=$1 AND revoked_at IS NULL", [current.claims.familyId])).rows).toHaveLength(0);
  });

  it("preserves supported environment-manager login with proof bound to the exact configured verifier", async () => {
    vi.stubEnv("ALLOW_LEGACY_MANAGER_AUTH", "1");
    vi.stubEnv("MANAGER_TENANT_ID", "a"); vi.stubEnv("MANAGER_USERNAME", "configured-manager");
    const salt = randomBytes(16).toString("hex");
    vi.stubEnv("MANAGER_PASSWORD_HASH", `${salt}:${scryptSync(" environment manager exact password ", salt, 32).toString("hex")}`);
    vi.stubEnv("MANAGER_PASSWORD_HASH_FILE", "");
    const response = await managerLogin(new Request("http://localhost:3000/api/auth/manager/login", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ username: "configured-manager", password: " environment manager exact password " }) }));
    expect(response.status).toBe(200);
    const token = cookie(response, "mgr_session"), claims = (await verifyWorkspaceToken(token))!;
    expect(claims).toMatchObject({ kind: "manager", tenantId: "a", role: "owner" });
    expect(claims.userId).toBeUndefined();
    const confirmed = await confirmPassword(new Request("http://localhost:3000/api/auth/reauth/password", { method: "POST", headers: { origin: "http://localhost:3000", cookie: `mgr_session=${token}`, "content-type": "application/json" }, body: JSON.stringify({ password: " environment manager exact password " }) }));
    expect(confirmed.status).toBe(200);
    expect(await verifyWorkspaceToken(cookie(confirmed, "mgr_session"))).not.toBeNull();
    vi.stubEnv("MANAGER_PASSWORD_HASH", `${salt}:${scryptSync("changed configured password", salt, 32).toString("hex")}`);
    expect(await verifyWorkspaceToken(cookie(confirmed, "mgr_session"))).toBeNull();
  });

  it("rejects hostile origins and duplicated cookies without changing activity", async () => {
    const current = await session();
    const before = (await pool().query("SELECT last_seen_at FROM workspace_session_security WHERE family_id=$1", [current.claims.familyId])).rows[0];
    const hostileHeaders: Record<string,string>[] = [{ origin: "https://hostile.example", cookie: `cust_session=${current.access}` }, { origin: "http://localhost:3000", "sec-fetch-site": "cross-site", cookie: `cust_session=${current.access}` }];
    for (const headers of hostileHeaders) {
      expect((await activity(new Request("http://localhost:3000/api/auth/activity", { method: "POST", headers }))).status).toBe(403);
    }
    expect((await activity(new Request("http://localhost:3000/api/auth/activity", { method: "POST", headers: { origin: "http://localhost:3000", cookie: `cust_session=${current.access}; cust_session=${current.access}` } }))).status).toBe(401);
    expect((await pool().query("SELECT last_seen_at FROM workspace_session_security WHERE family_id=$1", [current.claims.familyId])).rows[0]).toEqual(before);
  });

  it("accepts the canonical exact 4096-character password and bounds a streamed body", async () => {
    const exact = " \t" + "é".repeat(4092) + "\t ";
    await pool().query("UPDATE users SET password_hash=$1 WHERE id='u'", [await hashPassword(exact)]);
    const loggedIn = await login(req("/api/auth/login", "", { email: "u@example.test", password: exact, tenantId: "a" }));
    expect(loggedIn.status).toBe(200);
    const token = cookie(loggedIn, "cust_session");
    expect((await confirmPassword(req("/api/auth/reauth/password", token, { password: exact.trim() }))).status).toBe(403);
    expect((await confirmPassword(req("/api/auth/reauth/password", token, { password: exact + "x" }))).status).toBe(400);
    let cancelled = false;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(32*1024+1)); }, cancel() { cancelled = true; } });
    const oversized = new Request("http://localhost:3000/api/auth/reauth/password", { method: "POST", headers: { origin: "http://localhost:3000", cookie: `cust_session=${token}` }, body, duplex: "half" } as RequestInit & { duplex: "half" });
    expect((await confirmPassword(oversized)).status).toBe(413);
    expect(cancelled).toBe(true);
    const confirmed = await confirmPassword(req("/api/auth/reauth/password", token, { password: exact }));
    expect(confirmed.status).toBe(200);
    expect(JSON.stringify(await confirmed.json())).not.toMatch(/credentialVersion|accessToken|refreshToken|passwordHash/);
  });

  it("rolls back both password proof and predecessor revocation when successor persistence fails", async () => {
    const current = await session();
    const before = (await pool().query("SELECT password_verified_at,last_seen_at,expires_at FROM workspace_session_security WHERE family_id=$1", [current.claims.familyId])).rows[0];
    await pool().query("CREATE FUNCTION reject_workspace_successor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic successor refusal'; END $$");
    await pool().query("CREATE TRIGGER reject_workspace_successor BEFORE INSERT ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION reject_workspace_successor()");
    try {
      const rejected = await confirmPassword(req("/api/auth/reauth/password", current.access, { password }));
      expect(rejected.status).toBe(503);
      expect(rejected.headers.getSetCookie()).toEqual([]);
      expect(await verifyWorkspaceToken(current.access)).not.toBeNull();
      expect((await pool().query("SELECT password_verified_at,last_seen_at,expires_at FROM workspace_session_security WHERE family_id=$1", [current.claims.familyId])).rows[0]).toEqual(before);
      expect((await pool().query("SELECT revoked_at FROM refresh_tokens WHERE id=$1", [current.claims.sid])).rows[0].revoked_at).toBeNull();
    } finally {
      await pool().query("DROP TRIGGER reject_workspace_successor ON refresh_tokens");
      await pool().query("DROP FUNCTION reject_workspace_successor()");
    }
  });

  it("applies the forward security cutover without inventing policy or revoking platform families", async () => {
    const client = await pool().connect(), schema = `workspace_cutover_${randomBytes(8).toString("hex")}`;
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema}`);
      await client.query("CREATE TABLE tenants(id text PRIMARY KEY); CREATE TABLE users(id text PRIMARY KEY); CREATE TABLE refresh_tokens(kind text,revoked_at timestamp,revoked_reason text); CREATE TABLE manager_sessions(revoked_at timestamp)");
      await client.query("INSERT INTO refresh_tokens(kind) VALUES ('customer'),('manager'),('platform'); INSERT INTO manager_sessions VALUES (NULL)");
      const migration = readFileSync("drizzle/0091_workspace_session_security.sql", "utf8").replaceAll('"public".', `"${schema}".`);
      for (const statement of migration.split("--> statement-breakpoint").filter(s => s.trim())) await client.query(statement);
      const rows = (await client.query("SELECT kind,revoked_at IS NOT NULL revoked,revoked_reason FROM refresh_tokens ORDER BY kind")).rows;
      expect(rows).toEqual([{kind:"customer",revoked:true,revoked_reason:"workspace_security_cutover"},{kind:"manager",revoked:true,revoked_reason:"workspace_security_cutover"},{kind:"platform",revoked:false,revoked_reason:null}]);
      expect((await client.query("SELECT revoked_at IS NOT NULL revoked FROM manager_sessions")).rows).toEqual([{revoked:true}]);
      expect((await client.query("SELECT count(*)::integer n FROM workspace_session_security")).rows[0].n).toBe(0);
      // Rollback preserves the original ledger and leaves no synthetic schema.
    } finally { await client.query("ROLLBACK"); client.release(); }
  });

  it("rejects a workspace switch queued behind reauthentication of its original access SID", async () => {
    const current = await session(), blocker = await pool().connect();
    const source = req("/api/auth/reauth/password", current.access, { password });
    let confirming: Promise<Response> | undefined, switching: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query("SELECT pg_backend_pid() n")).rows[0].n;
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [current.claims.familyId]);
      confirming = beginConfirmation(source);
      const confirmingPid = await waitForBlockedBy(pid);
      switching = selectTenant(req("/api/auth/select-tenant", current.access, { tenantId: "b" }));
      await waitForBlockedBy(confirmingPid);
      await blocker.query("COMMIT");
      expect((await confirming).status).toBe(200);
      expect((await switching).status).toBe(401);
      expect((await pool().query("SELECT family_id FROM workspace_session_security WHERE user_id='u' AND tenant_id='b'")).rows).toHaveLength(0);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); await Promise.allSettled([confirming,switching]); }
  });

  it("cannot preserve a reauthentication successor across a concurrent password reset", async () => {
    const current = await session(), token = randomBytes(32).toString("base64url");
    await pool().query("INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at) VALUES ($1,'u',$2,clock_timestamp()+interval '20 minutes')", [randomBytes(16).toString("hex"), await hashToken(token)]);
    const [confirmed, reset] = await Promise.all([
      confirmPassword(req("/api/auth/reauth/password", current.access, { password })),
      resetPassword(req("/api/auth/reset-password", "", { token, password: "changed-workspace-reset-password-72!" })),
    ]);
    expect(reset.status).toBe(200);
    expect([200,401,403]).toContain(confirmed.status);
    expect(await verifyWorkspaceToken(current.access)).toBeNull();
    if (confirmed.status === 200) expect(await verifyWorkspaceToken(cookie(confirmed, "cust_session"))).toBeNull();
    expect((await pool().query("SELECT id FROM refresh_tokens WHERE user_id='u' AND revoked_at IS NULL")).rows).toHaveLength(0);
    expect((await rotateRefreshToken("customer", current.refreshToken)).status).toBe("invalid");
  });

  it.each([
    ["Odoo cutover", cutoverOdoo, { mode:"strict_v2",verifiedExternalOutboxes:true,verifiedReceiptBackup:true,verifiedAllInstallationsEnrolled:true }],
    ["historical Odoo resolution", resolveOdoo, { installationId:"11111111-1111-4111-8111-111111111111",sourceCompanyId:"1",sourceOperationId:"test",disposition:"distinct",expectedLegacyJobId:"old",expectedLegacyFingerprint:"0".repeat(64),operatorAttestation:"HISTORY_AND_PHYSICAL_OUTCOME_REVIEWED" }],
    ["Agent creation", createAgent, { name:"Unconfirmed Agent" }],
  ] as const)("preserves the usable policy denial through %s adapters and performs no write", async (_name, handler, body) => {
    const current = await session();
    await pool().query("UPDATE workspace_session_security SET created_at=created_at-interval '10 minutes',password_verified_at=password_verified_at-interval '6 minutes' WHERE family_id=$1", [current.claims.familyId]);
    const response = await handler(req("/api/test-privileged-operation", current.access, body));
    expect(response.status).toBe(403);
    expect(response.headers.get("X-Yaseir-Reauthentication")).toBe("required");
    expect(await response.json()).toMatchObject({ code:"WORKSPACE_REAUTHENTICATION_REQUIRED",reauthenticationUrl:"/settings?reauth=1" });
    for (const table of ["agents","odoo_legacy_resolutions","odoo_v2_operations"]) {
      expect((await pool().query(`SELECT count(*)::integer n FROM ${table}`)).rows[0].n).toBe(0);
    }
  });

  it("reports a clock-store outage as unavailable without asserting expiry or changing assurance", async () => {
    const current = await session();
    const before = (await pool().query("SELECT password_verified_at,last_seen_at FROM workspace_session_security WHERE family_id=$1", [current.claims.familyId])).rows[0];
    const clock = vi.spyOn(databaseClock, "databaseNowMs").mockRejectedValue(new Error("synthetic database clock unavailable"));
    try {
      const { GET } = await import("../src/app/api/auth/reauth/status/route");
      for (const response of [await GET(req("/api/auth/reauth/status", current.access)),
        await activity(req("/api/auth/activity", current.access, {})),
        await confirmPassword(req("/api/auth/reauth/password", current.access, { password }))]) {
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ code: "SECURITY_UNAVAILABLE" });
        expect(response.headers.getSetCookie()).toEqual([]);
      }
    } finally { clock.mockRestore(); }
    expect((await pool().query("SELECT password_verified_at,last_seen_at FROM workspace_session_security WHERE family_id=$1", [current.claims.familyId])).rows[0]).toEqual(before);
    expect(await verifyWorkspaceToken(current.access)).not.toBeNull();
  });
});
