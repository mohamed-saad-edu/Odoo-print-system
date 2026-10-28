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

function fixture(active = true) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const tx = {
    execute: async (fragment: Parameters<typeof dialect.sqlToQuery>[0]) => {
      const query = dialect.sqlToQuery(fragment);
      statements.push(query);
      return { rows: active ? [{ id: actor.sid }] : [] };
    },
  } as unknown as DbTx;
  return { tx, statements };
}

describe("Platform subscription-list live read authority", () => {
  it("locks all three live identity rows through data reads without requiring five-minute step-up", async () => {
    const { tx, statements } = fixture();
    await expect(requirePlatformReadAuthorityInTransaction(tx, actor)).resolves.toBeUndefined();
    expect(statements).toHaveLength(1);
    const statement = statements[0].sql;
    for (const required of [
      "FROM users u", "JOIN refresh_tokens r", "JOIN platform_session_security s",
      "FOR SHARE OF u, r, s", "u.is_platform_owner = true",
      "u.email_verified_at IS NOT NULL", "r.tenant_id IS NULL",
      "r.kind = 'platform'", "r.revoked_at IS NULL", "s.revoked_at IS NULL",
      "s.password_version = encode(sha256(convert_to(u.password_hash",
      "s.last_seen_at > clock_timestamp() - interval '30 minutes'",
      "s.password_verified_at <= clock_timestamp()",
    ]) expect(statement).toContain(required);
    expect(statement).not.toContain("s.password_verified_at > clock_timestamp() - interval '5 minutes'");
    expect(statements[0].params).toEqual([
      actor.userId, actor.email, actor.familyId, actor.sid, actor.email, actor.exp, actor.iat,
    ]);
  });

  it("rejects a changed, revoked or expired owner/session after preflight", async () => {
    await expect(requirePlatformReadAuthorityInTransaction(fixture(false).tx, actor))
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
