import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DbTx } from "../src/db";
import { requireTeamActorInTransaction, TeamAuthorizationChangedError } from "../src/lib/team-authorization";
import { credentialVersionFor } from "../src/lib/session-credentials";

const dialect = new PgDialect();
function database(role: string | null, active: boolean, lifecycle = "active") {
  const statements: string[] = [];
  const tx = {
    execute: async (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
      const sql = dialect.sqlToQuery(query).sql;
      statements.push(sql);
      if (/FROM tenants/.test(sql)) return { rows: [{ lifecycle }] };
      if (/FROM workspace_session_security/.test(sql) && active) return { rows: [{
        familyId: actor.familyId, kind: actor.kind, userId: actor.userId, tenantId: actor.tenantId,
        credentialVersion: credentialVersionFor(actor.userId, "verified-fixture-password-hash"),
        passwordHash: "verified-fixture-password-hash", verified: true, createdAtMs: 1000,
        passwordVerifiedAtMs: 1000, lastSeenAtMs: 1000, expiresAtMs: 1000000, nowMs: 2000,
      }] };
      if (/UPDATE workspace_session_security/.test(sql)) return { rows: [{ now_ms: 2000 }] };
      return { rows: /FROM (refresh_tokens|manager_sessions)/.test(sql) && active ? [{ id: "session" }] : [] };
    },
    query: { tenantUsers: { findFirst: async () => role ? { role } : undefined } },
  } as unknown as DbTx;
  return { tx, statements };
}
const actor = { userId: "admin", tenantId: "workspace", role: "owner" as const,
  kind: "manager" as const, sub: "manager" as const, jti: "a".repeat(32),
  ver: 2 as const, sid: "b".repeat(32), familyId: "f".repeat(32), iat: 1, exp: 9999999999 };

describe("transactional team authority", () => {
  process.env.GATEWAY_JWT_SECRET = "team-authority-tests-secret-at-least-32";
  it.each(["admin", "viewer", "operator", null])("denies a removed/demoted actor (%s) before mutation", async role => {
    const { tx } = database(role, true);
    await expect(requireTeamActorInTransaction(tx, actor, ["target"])).rejects.toBeInstanceOf(TeamAuthorizationChangedError);
  });
  it("denies a revoked family even when membership still grants permission", async () => {
    const { tx } = database("owner", false);
    await expect(requireTeamActorInTransaction(tx, actor)).rejects.toBeInstanceOf(TeamAuthorizationChangedError);
  });
  it("allows the current owner with a live family and orders shared user locks", async () => {
    const { tx, statements } = database("owner", true);
    await expect(requireTeamActorInTransaction(tx, actor, ["target", "admin"])).resolves.toBeUndefined();
    expect(statements[0]).toContain("FROM tenants");
    expect(statements[0]).toContain("FOR SHARE");
    expect(statements[1]).toContain("ORDER BY id FOR UPDATE");
    expect(statements.some(statement => /FROM refresh_tokens/.test(statement) && /FOR SHARE/.test(statement))).toBe(true);
    expect(statements.some(statement => /FROM workspace_session_security/.test(statement) && /FOR UPDATE OF s/.test(statement))).toBe(true);
    expect(statements.some(statement => /credential_version/.test(statement) && /password_hash/.test(statement) && /password_verified_at/.test(statement))).toBe(true);
  });
  it.each(["suspended", "deleted", "unexpected"])("denies %s tenant before user/session locks", async lifecycle => {
    const { tx, statements } = database("owner", true, lifecycle);
    await expect(requireTeamActorInTransaction(tx, actor)).rejects.toBeInstanceOf(TeamAuthorizationChangedError);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("FROM tenants");
  });
  it("requires fresh login for live and revoked legacy sessions after the policy cutover", async () => {
    const legacy = { ...actor, ver: undefined, kind: undefined, sid: undefined, familyId: undefined };
    await expect(requireTeamActorInTransaction(database("owner", true).tx, legacy)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    await expect(requireTeamActorInTransaction(database("owner", false).tx, legacy)).rejects.toBeInstanceOf(TeamAuthorizationChangedError);
  });
});
