import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { db } from "../src/db";
import { agents, printers } from "../src/db/schema";
import { and, eq } from "drizzle-orm";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll } from "./helpers/pg";
import { claimJobForDelivery, releaseUndeliveredClaim } from "../src/lib/job-delivery";
import { hashSecret, validateAgent } from "../src/lib/agent-auth";
import { nanoid } from "../src/lib/nanoid";

/**
 * TEN-01 / TEN-02: the Agent identity and the in-memory WebSocket registry
 * are keyed by a globally unique Agent id, never by a client-supplied
 * tenant id. These tests use two tenants with deliberately overlapping
 * identifiers to prove that neither the credential lookup nor the delivery
 * path can be steered across a tenant boundary.
 */
const suite = describe.skipIf(!hasTestDatabase);

suite("agent identity and socket isolation across tenants", () => {
  beforeAll(async () => { await applyMigrations(); });
  afterAll(async () => { await closePool(); });
  beforeEach(async () => { await truncateAll(); });

  it("resolves an Agent to exactly one tenant and never to a client-supplied one", async () => {
    const a = await seedFixture();
    const b = await seedFixture();

    // An Agent id is the primary key of the agents table, so it is globally
    // unique. Both tenants can therefore hold Agents whose ids share a
    // tenant-looking prefix while differing only in the random suffix.
    const lookalike = `agt_${a.tenantId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 4)}${nanoid(4)}`;
    const lookalikeSecret = `secret-${nanoid(8)}`;
    await pool().query(
      `INSERT INTO agents (id, tenant_id, name, status, lifecycle, secret) VALUES ($1, $2, 'Lookalike', 'online', 'active', $3)`,
      [lookalike, b.tenantId, hashSecret(lookalikeSecret)],
    );

    // The correct secret resolves to the OWNING tenant, never to the tenant
    // whose id the attacker supplied.
    const resolved = await validateAgent(`Bearer ${lookalike}:${lookalikeSecret}`);
    expect(resolved?.id).toBe(lookalike);
    expect(resolved?.tenantId).toBe(b.tenantId);

    // A wrong secret must never resolve, even with a valid agent id.
    expect(await validateAgent(`Bearer ${lookalike}:wrong-secret`)).toBeNull();

    // The first tenant's own Agent still resolves to the first tenant.
    const owner = await db.query.agents.findFirst({ where: eq(agents.id, a.agentId) });
    expect(owner?.tenantId).toBe(a.tenantId);
  });

  it("does not let a second tenant's Agent claim or release the first tenant's job", async () => {
    const a = await seedFixture();
    const b = await seedFixture();
    const jobId = `job_adv_${nanoid(8)}`;
    await pool().query(
      `INSERT INTO print_jobs (id, tenant_id, agent_id, printer_id, status, payload, expires_at)
       VALUES ($1, $2, $3, $4, 'queued', $5::jsonb, now() + interval '1 hour')`,
      [jobId, a.tenantId, a.agentId, a.printerId, JSON.stringify({ type: "raw", protocol: "raw", encoding: "base64", data: "aGVsbG8=" })],
    );

    // A foreign Agent cannot claim the job.
    expect(await claimJobForDelivery(jobId, b.agentId)).toBeNull();

    // And cannot release a claim token it never obtained.
    const claim = await claimJobForDelivery(jobId, a.agentId);
    expect(claim?.claimToken).toBeTruthy();
    const foreignRelease = await releaseUndeliveredClaim(jobId, a.tenantId, b.agentId, claim!.claimToken, "cross-tenant release attempt");
    expect(foreignRelease).toBe("noop");

    // The owning Agent can still release it normally.
    expect(await releaseUndeliveredClaim(jobId, a.tenantId, a.agentId, claim!.claimToken, "owner release")).toBe("requeued");
  });

  it("refuses to bind a printer to an Agent owned by another tenant", async () => {
    const a = await seedFixture();
    const b = await seedFixture();
    const printerId = `printer_cross_${nanoid(8)}`;
    await expect(pool().query(
      `INSERT INTO printers (id, tenant_id, agent_id, name, status, lifecycle) VALUES ($1, $2, $3, 'Cross', 'offline', 'active')`,
      [printerId, a.tenantId, b.agentId],
    )).rejects.toThrow();
  });

  it("keeps an Agent's lifecycle row tenant-scoped for every consumer", async () => {
    const a = await seedFixture();
    const b = await seedFixture();
    await pool().query(`UPDATE agents SET lifecycle = 'retired' WHERE id = $1`, [a.agentId]);

    const retired = await db.query.agents.findFirst({ where: and(eq(agents.id, a.agentId), eq(agents.tenantId, a.tenantId)) });
    expect(retired?.lifecycle).toBe("retired");
    // The other tenant's Agent is unaffected.
    const other = await db.query.agents.findFirst({ where: and(eq(agents.id, b.agentId), eq(agents.tenantId, b.tenantId)) });
    expect(other?.lifecycle).toBe("active");
    // And a retired Agent in another tenant cannot appear under this tenant.
    const cross = await db.query.agents.findFirst({ where: and(eq(agents.id, a.agentId), eq(agents.tenantId, b.tenantId)) });
    expect(cross).toBeUndefined();
  });

  it("does not let a tenant list or claim printers bound to another tenant's Agent", async () => {
    const a = await seedFixture();
    const b = await seedFixture();
    const foreign = await db.query.printers.findMany({
      where: and(eq(printers.tenantId, b.tenantId), eq(printers.agentId, b.agentId)),
    });
    expect(foreign.length).toBeGreaterThan(0);
    expect(foreign.every((p) => p.tenantId === b.tenantId)).toBe(true);
    const mine = await db.query.printers.findMany({
      where: and(eq(printers.tenantId, a.tenantId), eq(printers.agentId, b.agentId)),
    });
    expect(mine).toEqual([]);
  });
});
