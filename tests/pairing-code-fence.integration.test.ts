import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { POST as registerPOST } from "../src/app/api/agent/register/route";
import { hashPairingCode } from "../src/lib/agent-auth";
import { hasTestDatabase, applyMigrations, truncateAll, seedFixture, closePool, pool } from "./helpers/pg";

const suite = describe.skipIf(!hasTestDatabase);

suite("pairing velocity fences (T-1/S-2)", () => {
  const previousTrustProxy = process.env.TRUST_PROXY;
  beforeAll(async () => {
    await applyMigrations();
    process.env.TRUST_PROXY = "1";
  });
  afterAll(async () => {
    if (previousTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previousTrustProxy;
    await closePool();
  });
  beforeEach(async () => { await truncateAll(); });

  function attempt(code: string, ip: string) {
    return registerPOST(new Request("http://gateway.test/api/agent/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ pairingCode: code }),
    }));
  }

  it("does not consume a pairing code after waiting past subscription expiry", async () => {
    const f = await seedFixture();
    await pool().query("UPDATE agents SET pairing_code_hash=$1,pairing_code_expires_at=clock_timestamp()+interval '10 minutes',secret=NULL WHERE id=$2", [hashPairingCode("QW24RT"), f.agentId]);
    await pool().query("UPDATE tenant_subscriptions SET current_period_end=clock_timestamp()+interval '1 second' WHERE tenant_id=$1", [f.tenantId]);
    const locker = await pool().connect();
    try {
      await locker.query("BEGIN");
      await locker.query("SELECT tenant_id FROM tenant_subscriptions WHERE tenant_id=$1 FOR UPDATE", [f.tenantId]);
      const { rows: [{ pid }] } = await locker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const response = attempt("QW24RT", "10.9.0.100");
      await vi.waitFor(async () => {
        const waiting = await pool().query("SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))", [pid]);
        expect(waiting.rows.length).toBeGreaterThan(0);
      });
      await vi.waitFor(async () => {
        const expired = await pool().query("SELECT current_period_end<=clock_timestamp() AS expired FROM tenant_subscriptions WHERE tenant_id=$1", [f.tenantId]);
        expect(expired.rows[0].expired).toBe(true);
      }, { timeout: 3000 });
      await locker.query("COMMIT");
      const result = await response;
      expect(result.status).toBe(403);
      expect(await result.json()).toMatchObject({ code: "SUBSCRIPTION_REQUIRED" });
      const agent = await pool().query("SELECT secret,pairing_code_hash FROM agents WHERE id=$1", [f.agentId]);
      expect(agent.rows[0]).toEqual({ secret: null, pairing_code_hash: hashPairingCode("QW24RT") });
    } finally { await locker.query("ROLLBACK"); locker.release(); }
  });

  it("locks one code across rotating IPs (distributed brute force fenced per code)", async () => {
    const f = await seedFixture();
    await pool().query(
      `UPDATE agents SET pairing_code_hash = $1, pairing_code_expires_at = now() + interval '30 minutes', secret = NULL WHERE id = $2`,
      [hashPairingCode("QW24RT"), f.agentId],
    );
    // Same wrong code from a rotating botnet: early attempts are plain 400s.
    for (let i = 0; i < 4; i++) {
      const res = await attempt("ZZ99ZZ", `10.9.0.${i + 1}`);
      expect(res.status).toBe(400);
    }
    // The per-code bucket trips: further guesses for that code are 429 even
    // from fresh IPs, while the real code from a clean IP still works.
    const blocked = await attempt("ZZ99ZZ", "10.9.0.99");
    expect(blocked.status).toBe(429);
    const legit = await attempt("QW24RT", "10.9.0.100");
    expect(legit.status).toBe(200);
  });

  it("does not share one global bucket across unknown source addresses", async () => {
    const prev = process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY;
    try {
      const f = await seedFixture();
      await pool().query(
        `UPDATE agents SET pairing_code_hash = $1, pairing_code_expires_at = now() + interval '30 minutes', secret = NULL WHERE id = $2`,
        [hashPairingCode("QW24RT"), f.agentId],
      );
      for (let i = 0; i < 3; i++) {
        const res = await attempt("ZZ99ZZ", "10.9.0.50");
        expect(res.status).toBe(400);
      }
      // Unknown-IP clients are not lumped into pairing-ip:unknown; the real
      // code still pairs.
      const legit = await attempt("QW24RT", "10.9.0.50");
      expect(legit.status).toBe(200);
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = prev;
    }
  });
});
