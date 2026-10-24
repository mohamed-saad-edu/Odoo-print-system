import { issueWorkspaceTestSession } from "./helpers/workspace-session";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, closePool, hasTestDatabase, pool, truncateAll } from "./helpers/pg";
import { isSessionFamilyActive, rotateRefreshToken, verifyAccessTokenSignature } from "../src/lib/session-tokens";
import { GET, POST } from "../src/app/api/auth/sessions/route";
import { hashPassword } from "../src/lib/password";
import { authenticateCustomer, validateWorkspaceManager, verifyWorkspaceToken } from "../src/lib/manager-auth";
import { revokeOwnSessions } from "../src/lib/session-inventory";
import { requireManagerActorInTransaction } from "../src/lib/manager-mutation-authorization";
import { requireTeamActorInTransaction } from "../src/lib/team-authorization";
import { requireActiveTenantInTransaction } from "../src/lib/tenant-guard";
import { db } from "../src/db";
import { createHmac, randomBytes } from "node:crypto";
import { POST as logout } from "../src/app/api/auth/logout/route";

let passwordHash: string;
const password = "session-inventory-fixture-93!";

describe.skipIf(!hasTestDatabase)("customer-owned account-wide session inventory", () => {
  beforeAll(async () => { process.env.GATEWAY_JWT_SECRET = "session-inventory-tests-secret-at-least-32"; process.env.APP_BASE_URL = "http://localhost:3000"; await applyMigrations(); passwordHash = await hashPassword(password); });
  beforeEach(async () => {
    await truncateAll();
    await pool().query("INSERT INTO tenants(id,name) VALUES ('a','A'),('b','B')");
    await pool().query("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES ('u','u@example.test',$1,clock_timestamp()),('v','v@example.test',$1,clock_timestamp())", [passwordHash]);
    await pool().query("INSERT INTO tenant_users(user_id,tenant_id,role) VALUES ('u','a','viewer'),('u','b','viewer'),('v','a','viewer')");
  });
  afterAll(closePool);
  const pair = (tenantId: string, userId = "u") => issueWorkspaceTestSession({ kind: "customer", tenantId, userId, email: `${userId}@example.test`, role: "viewer" });
  const req = (token: string, body?: unknown) => new Request("http://localhost:3000/api/auth/sessions", {
    method: body ? "POST" : "GET", headers: { cookie: `cust_session=${token}`, origin: "http://localhost:3000", "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const cookie = (response: Response, name: string) => response.headers.getSetCookie()
    .find(value => value.startsWith(`${name}=`))?.split(";")[0].slice(name.length + 1);

  it("lists the current user's workspaces and never another account, tokens or hashes", async () => {
    const own = await pair("a"), otherTenant = await pair("b"), otherUser = await pair("a", "v");
    const response = await GET(req(own.accessToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(new Set(body.sessions.map((s: { id: string }) => s.id))).toEqual(new Set([own.familyId, otherTenant.familyId]));
    expect(body.sessions.find((s: { id: string }) => s.id === own.familyId).current).toBe(true);
    const text = JSON.stringify(body);
    expect(text).not.toContain(own.refreshToken);
    expect(text).not.toContain("tokenHash");
    expect(body.sessions.find((s: { id: string }) => s.id === otherTenant.familyId)).toMatchObject({ tenantId: "b", tenantName: "B", current: false });
    expect(text).not.toContain(otherUser.familyId);
  });

  it("denies other accounts and unknown targets and revokes other sessions across the user's workspaces", async () => {
    const own = await pair("a"), ownOther = await pair("a"), otherTenant = await pair("b"), otherUser = await pair("a", "v");
    expect((await POST(req(own.accessToken, { action: "revoke", id: "f".repeat(32), password }))).status).toBe(404);
    expect((await POST(req(own.accessToken, { action: "revoke", id: otherUser.familyId, password }))).status).toBe(404);
    expect((await POST(req(own.accessToken, { action: "revoke_others", password }))).status).toBe(200);
    expect(await isSessionFamilyActive(own.familyId, "customer", "a", "u")).toBe(true);
    expect(await isSessionFamilyActive(ownOther.familyId, "customer", "a", "u")).toBe(false);
    expect(await isSessionFamilyActive(otherTenant.familyId, "customer", "b", "u")).toBe(false);
    expect(await isSessionFamilyActive(otherUser.familyId, "customer", "a", "v")).toBe(true);
  });

  it("requires fresh password confirmation before revocation", async () => {
    const own = await pair("a"), ownOther = await pair("a");
    expect((await POST(req(own.accessToken, { action: "revoke", id: ownOther.familyId }))).status).toBe(400);
    expect((await POST(req(own.accessToken, { action: "revoke", id: ownOther.familyId, password: "wrong" }))).status).toBe(401);
    expect(await isSessionFamilyActive(ownOther.familyId, "customer", "a", "u")).toBe(true);
  });

  it("accepts the canonical 4096-character password without trimming whitespace", async () => {
    const longPassword = " \t" + "é".repeat(4092) + "\t ";
    await pool().query("UPDATE users SET password_hash=$1 WHERE id='u'", [await hashPassword(longPassword)]);
    const own = await pair("a"), ownOther = await pair("a");
    const revokeRequest = (candidate: string) => {
      const body = JSON.stringify({ action: "revoke", id: ownOther.familyId, password: candidate });
      return new Request("http://localhost:3000/api/auth/sessions", { method: "POST", headers: {
        cookie: `cust_session=${own.accessToken}`, origin: "http://localhost:3000", "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      }, body });
    };
    expect((await POST(revokeRequest(longPassword.trim()))).status).toBe(401);
    expect((await POST(revokeRequest(longPassword + "x"))).status).toBe(400);
    expect((await POST(revokeRequest(longPassword))).status).toBe(200);
    expect(await isSessionFamilyActive(ownOther.familyId, "customer", "a", "u")).toBe(false);
  });

  it.each(["customer", "manager"] as const)("rotates surviving %s access and refresh tokens without extending the family", async kind => {
    await pool().query("UPDATE tenant_users SET role='owner' WHERE user_id='u' AND tenant_id='a'");
    const current = await issueWorkspaceTestSession({ kind, tenantId: "a", userId: "u", email: "u@example.test", role: "owner" });
    const other = await issueWorkspaceTestSession({ kind, tenantId: "a", userId: "u", email: "u@example.test", role: "owner" });
    // Deliberately make the family older than the presented access token so a
    // fresh 30-day expiry at reauthentication would be a detectable extension.
    await pool().query("UPDATE refresh_tokens SET family_created_at=family_created_at-interval '1 day', expires_at=expires_at-interval '1 day' WHERE family_id=$1", [current.familyId]);
    const before = (await pool().query("SELECT family_created_at, expires_at FROM refresh_tokens WHERE id=$1", [current.refreshTokenId])).rows[0];
    const prefix = kind === "customer" ? "cust" : "mgr";
    const request = (body?: unknown) => new Request("http://localhost:3000/api/auth/sessions", {
      method: body ? "POST" : "GET", headers: { cookie: `${prefix}_session=${current.accessToken}`, origin: "http://localhost:3000", "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const priorClaims = (await validateWorkspaceManager(request()))!;
    const response = await POST(request({ action: "revoke", id: other.familyId, password }));
    expect(response.status).toBe(200);
    const nextAccess = cookie(response, `${prefix}_session`);
    const nextRefresh = cookie(response, `${prefix}_refresh`);
    expect(nextAccess).toBeTruthy();
    expect(nextRefresh).toBeTruthy();
    expect(nextAccess).not.toBe(current.accessToken);
    expect(nextRefresh).not.toBe(current.refreshToken);
    expect(response.headers.getSetCookie().every(value => value.startsWith(`${prefix}_`))).toBe(true);
    const body = await response.json();
    expect(body.signedOut).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/accessToken|refreshToken|credentialVersion|passwordHash/);
    const nextClaims = verifyAccessTokenSignature(nextAccess!, kind)!;
    expect(nextClaims).toMatchObject({ familyId: current.familyId, kind, tenantId: "a", userId: "u", role: "owner" });
    expect(nextClaims.sid).not.toBe(priorClaims.sid);
    const after = (await pool().query("SELECT family_created_at, expires_at FROM refresh_tokens WHERE id=$1", [nextClaims.sid])).rows[0];
    expect(after).toEqual(before);
    expect(await verifyWorkspaceToken(current.accessToken)).toBeNull();
    expect((await GET(request())).status).toBe(401);
    expect((await rotateRefreshToken(kind, current.refreshToken)).status).toBe("invalid");
    // Reject already-validated old claims again at each mutation boundary.
    await expect(db.transaction(async tx => {
      await requireActiveTenantInTransaction(tx, "a");
      await requireManagerActorInTransaction(tx, priorClaims, "tenant.read");
    })).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    await expect(db.transaction(tx => requireTeamActorInTransaction(tx, priorClaims))).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    const liveClaims = (await verifyWorkspaceToken(nextAccess!))!;
    expect(liveClaims).toBeTruthy();
    await expect(db.transaction(async tx => {
      await requireActiveTenantInTransaction(tx, "a");
      await requireManagerActorInTransaction(tx, liveClaims, "tenant.read");
      await requireTeamActorInTransaction(tx, liveClaims);
    })).resolves.toBeUndefined();
    expect((await rotateRefreshToken(kind, nextRefresh!)).status).toBe("rotated");
  });

  it("does not rotate or terminate the caller for a foreign target or rejected password", async () => {
    const current = await pair("a"), other = await pair("a"), foreign = await pair("a", "v");
    for (const [id, candidate, status] of [[foreign.familyId, password, 404], [other.familyId, "wrong", 401]] as const) {
      const response = await POST(req(current.accessToken, { action: "revoke", id, password: candidate }));
      expect(response.status).toBe(status);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await verifyWorkspaceToken(current.accessToken)).not.toBeNull();
      expect((await pool().query("SELECT COUNT(*)::integer AS n FROM refresh_tokens WHERE family_id=$1", [current.familyId])).rows[0].n).toBe(1);
    }
  });

  it("retains a shorter persisted expiry through reauthentication and subsequent refresh", async () => {
    const current = await pair("a");
    await pool().query("UPDATE refresh_tokens SET expires_at=clock_timestamp()+interval '2 hours' WHERE family_id=$1", [current.familyId]);
    const expiresAt = (await pool().query("SELECT expires_at FROM refresh_tokens WHERE id=$1", [current.refreshTokenId])).rows[0].expires_at;
    const response = await POST(req(current.accessToken, { action: "revoke_others", password }));
    expect(response.status).toBe(200);
    const nextAccess = cookie(response, "cust_session")!;
    const nextRefresh = cookie(response, "cust_refresh")!;
    const claims = verifyAccessTokenSignature(nextAccess, "customer")!;
    expect((await pool().query("SELECT expires_at FROM refresh_tokens WHERE id=$1", [claims.sid])).rows[0].expires_at).toEqual(expiresAt);
    const refreshed = await rotateRefreshToken("customer", nextRefresh);
    expect(refreshed.status).toBe("rotated");
    if (refreshed.status === "rotated") expect(refreshed.pair.refreshExpiresAt).toEqual(expiresAt);
  });

  it("rejects a changed credential after password verification without revocation or rotation", async () => {
    const current = await pair("a"), other = await pair("a");
    const claims = (await validateWorkspaceManager(req(current.accessToken)))!;
    const principal = (await authenticateCustomer("u@example.test", password))!;
    await pool().query("UPDATE users SET password_hash=$1 WHERE id='u'", [await hashPassword("replacement-session-password-34!")]);
    await expect(revokeOwnSessions({ scope: "workspace", claims }, "revoke", other.familyId, principal.credentialVersion)).rejects.toThrow(/expired or changed/i);
    // A changed password now invalidates all workspace proof at admission,
    // while the rejected operation itself must not mutate the refresh ledger.
    expect(await isSessionFamilyActive(other.familyId, "customer", "a", "u")).toBe(false);
    expect((await pool().query("SELECT revoked_at FROM refresh_tokens WHERE id=$1", [other.refreshTokenId])).rows[0].revoked_at).toBeNull();
    expect((await pool().query("SELECT COUNT(*)::integer AS n FROM refresh_tokens WHERE family_id=$1", [current.familyId])).rows[0].n).toBe(1);
  });

  it("allows only one concurrent reauthentication of the same presented session", async () => {
    const current = await pair("a");
    const results = await Promise.all([1, 2].map(() => POST(req(current.accessToken, { action: "revoke_others", password }))));
    expect(results.filter(response => response.status === 200)).toHaveLength(1);
    expect(results.filter(response => [401, 403].includes(response.status))).toHaveLength(1);
    const live = await pool().query("SELECT id FROM refresh_tokens WHERE family_id=$1 AND revoked_at IS NULL", [current.familyId]);
    expect(live.rows).toHaveLength(1);
    expect(live.rows[0].id).not.toBe(current.refreshTokenId);
  });

  it("fences a concurrent refresh before rotating the whole surviving family", async () => {
    const current = await pair("a");
    const [response, refresh] = await Promise.all([
      POST(req(current.accessToken, { action: "revoke_others", password })),
      rotateRefreshToken("customer", current.refreshToken),
    ]);
    expect(response.status).toBe(200);
    const next = cookie(response, "cust_session");
    expect(next).toBeTruthy();
    const currentClaims = verifyAccessTokenSignature(next!, "customer")!;
    const live = await pool().query("SELECT id FROM refresh_tokens WHERE family_id=$1 AND revoked_at IS NULL", [current.familyId]);
    expect(live.rows).toEqual([{ id: currentClaims.sid }]);
    if (refresh.status === "rotated") expect(await verifyWorkspaceToken(refresh.pair.accessToken)).toBeNull();
    else expect(refresh.status).toBe("invalid");
    expect(await verifyWorkspaceToken(current.accessToken)).toBeNull();
  });

  it("cannot create a surviving successor across concurrent logout", async () => {
    const current = await pair("a");
    const [response, signedOut] = await Promise.all([
      POST(req(current.accessToken, { action: "revoke_others", password })),
      logout(new Request("http://localhost:3000/api/auth/logout", { method: "POST", headers: { cookie: `cust_session=${current.accessToken}` } })),
    ]);
    expect(signedOut.status).toBe(200);
    expect([200, 401, 403]).toContain(response.status);
    expect(await isSessionFamilyActive(current.familyId, "customer", "a", "u")).toBe(false);
    expect((await rotateRefreshToken("customer", current.refreshToken)).status).toBe("invalid");
    const rotated = cookie(response, "cust_session");
    if (rotated) expect(await verifyWorkspaceToken(rotated)).toBeNull();
  });

  it("requires a new login before legacy sessions can perform password-confirmed revocation", async () => {
    const jti = `legacy_${randomBytes(16).toString("hex")}`;
    const now = Number((await pool().query("SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp())) AS now")).rows[0].now);
    const claims = { sub: "manager", jti, iat: now, exp: now + 8 * 3600, tenantId: "a", userId: "u", role: "viewer" };
    const encoded = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify(claims)).toString("base64url")].join(".");
    const token = `${encoded}.${createHmac("sha256", process.env.GATEWAY_JWT_SECRET!).update(encoded).digest("base64url")}`;
    await pool().query("INSERT INTO manager_sessions(jti,tenant_id,user_id,role,expires_at) VALUES ($1,'a','u','viewer',to_timestamp($2))", [jti, claims.exp]);
    const other = await pair("a"), foreign = await pair("b");
    const request = (id: string) => new Request("http://localhost:3000/api/auth/sessions", { method: "POST", headers: {
      cookie: `mgr_session=${token}`, origin: "http://localhost:3000", "content-type": "application/json",
    }, body: JSON.stringify({ action: "revoke", id, password }) });
    const denied = await POST(request(foreign.familyId));
    expect(denied.status).toBe(401);
    expect(denied.headers.getSetCookie()).toEqual([]);
    expect(await verifyWorkspaceToken(token)).toBeNull();
    const response = await POST(request(other.familyId));
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await verifyWorkspaceToken(token)).toBeNull();
    expect(await isSessionFamilyActive(other.familyId, "customer", "a", "u")).toBe(true);
    expect(await isSessionFamilyActive(foreign.familyId, "customer", "b", "u")).toBe(true);
  });
});
