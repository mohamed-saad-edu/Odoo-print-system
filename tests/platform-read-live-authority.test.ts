import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DbTx } from "../src/db";
import {
  PlatformUnauthorizedError,
  requirePlatformReadAuthorityInTransaction,
  type PlatformOwnerClaims,
} from "../src/lib/platform-auth";

const dialect = new PgDialect();
const actor: PlatformOwnerClaims = {
  sub: "platform_owner", userId: "owner", email: "owner@example.test",
  ver: 2, kind: "platform", familyId: "family", sid: "sid",
  iat: 1, exp: 901, jti: "a".repeat(32),
};

function fixture(ownerActive = true, sessionActive = true) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const tx = {
    execute: async (fragment: Parameters<typeof dialect.sqlToQuery>[0]) => {
      const query = dialect.sqlToQuery(fragment);
      statements.push(query);
      if (query.sql.includes("FROM users")) return { rows: ownerActive ? [{
        id: actor.userId, email: actor.email, isPlatformOwner: true,
        emailVerifiedAt: new Date(), passwordHash: "test-salted-verifier",
      }] : [] };
      if (query.sql.includes("pg_advisory_xact_lock")) return { rows: [{}] };
      return { rows: sessionActive ? [{ id: actor.sid }] : [] };
    },
  } as unknown as DbTx;
  return { tx, statements };
}
describe("Platform subscription-list live read authority", () => {
  it("acquires owner, then family, then credentials in the established lock order without mutation step-up", async () => {
    const { tx, statements } = fixture();
    await expect(requirePlatformReadAuthorityInTransaction(tx, actor)).resolves.toBeUndefined();
    expect(statements).toHaveLength(3);
    const owner = statements[0];
    expect(owner.sql).toContain("FROM users");
    expect(owner.sql).toContain("FOR SHARE");
    expect(owner.sql).not.toContain("FOR UPDATE");
    expect(owner.params).toEqual([actor.userId]);
    expect(statements[1].sql).toContain("pg_advisory_xact_lock(hashtextextended(");
    expect(statements[1].params).toEqual([actor.familyId]);
    const statement = statements[2].sql;
    for (const required of [
      "FROM refresh_tokens r", "JOIN platform_session_security s",
      "FOR SHARE OF r, s", "r.tenant_id IS NULL",
      "r.kind = 'platform'", "r.revoked_at IS NULL", "s.revoked_at IS NULL",
      "s.password_version =",
      "s.last_seen_at > clock_timestamp() - interval '30 minutes'",
      "s.password_verified_at <= clock_timestamp()",
    ]) expect(statement).toContain(required);
    expect(statement).not.toContain("s.password_verified_at > clock_timestamp() - interval '5 minutes'");
    expect(statements[2].params[0]).toBe(actor.userId);
    expect(statements[2].params[1]).toBe(actor.familyId);
    expect(statements[2].params[2]).toBe(actor.sid);
    expect(statements[2].params[3]).toBe(actor.email);
    expect(statements[2].params.slice(-2)).toEqual([actor.exp, actor.iat]);
  });

  it("denies an owner removed after preflight without acquiring downstream token locks", async () => {
    const { tx, statements } = fixture(false);
    await expect(requirePlatformReadAuthorityInTransaction(tx, actor))
      .rejects.toBeInstanceOf(PlatformUnauthorizedError);
    expect(statements).toHaveLength(1);
  });

  it("denies a revoked or expired refresh/password-policy session after owner revalidation", async () => {
    await expect(requirePlatformReadAuthorityInTransaction(fixture(true, false).tx, actor))
      .rejects.toBeInstanceOf(PlatformUnauthorizedError);
  });
  it("fails closed for legacy, partial and malformed platform sessions before a database query", async () => {
    for (const claims of [
      { ...actor, ver: undefined, kind: undefined, sid: undefined, familyId: undefined },
      { ...actor, sid: undefined }, { ...actor, familyId: undefined },
    ] as PlatformOwnerClaims[]) {
      const { tx, statements } = fixture();
      await expect(requirePlatformReadAuthorityInTransaction(tx, claims))
        .rejects.toBeInstanceOf(PlatformUnauthorizedError);
      expect(statements).toHaveLength(0);
    }
  });
});
