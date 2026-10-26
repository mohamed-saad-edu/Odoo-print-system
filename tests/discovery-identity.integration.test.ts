import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { hasTestDatabase, applyMigrations, truncateAll, seedFixture, pool, closePool } from "./helpers/pg";
import { POST as discoveryReport } from "../src/app/api/agent/discovery/route";
import { hashSecret } from "../src/lib/agent-auth";
import { readFileSync } from "node:fs";

describe.skipIf(!hasTestDatabase)("discovery identity deduplication at the actual ingestion boundary", () => {
  beforeAll(async () => { await applyMigrations(); });
  afterAll(async () => { await closePool(); });
  it("stores one logical device for multiple observations with the same stable identity", async () => {
    await truncateAll();
    const fixture = await seedFixture();
    await pool().query("INSERT INTO discovery_sessions (id, tenant_id, agent_id, status, config, stats) VALUES ('disc_identity_dedupe', $1, $2, 'running', '{}'::jsonb, '{}'::jsonb)", [fixture.tenantId, fixture.agentId]);
    const response = await discoveryReport(new Request("https://gateway.test/api/agent/discovery", { method: "POST", headers: { Authorization: fixture.agentAuth, "Content-Type": "application/json" }, body: JSON.stringify({ discoveryId: "disc_identity_dedupe", status: "completed", devices: ["mdns", "ipp", "snmp"].map(source => ({ id: "observed-" + source, stableId: "same-physical-printer", source: [source], protocol: "ipp", ipAddress: "192.168.1.50", port: 631 })) }) }));
    expect(response.status).toBe(200);
    const rows = await pool().query("SELECT identity_key, source FROM discovered_devices WHERE tenant_id=$1 AND agent_id=$2", [fixture.tenantId, fixture.agentId]);
    expect(rows.rows).toEqual([{ identity_key: "same-physical-printer", source: ["snmp"] }]);
  });

  it("keeps colliding local device IDs independent across Agents in one workspace", async () => {
    const fixture = await seedFixture();
    const secondAgent = "agt_second01";
    await pool().query("INSERT INTO agents(id,tenant_id,name,status,lifecycle,secret) VALUES($1,$2,'Second Agent','online','active',$3)", [secondAgent, fixture.tenantId, hashSecret("second-agent-secret")]);
    const observations = [
      { agentId: fixture.agentId, auth: fixture.agentAuth, ip: "192.168.1.50" },
      { agentId: secondAgent, auth: `Bearer ${secondAgent}:second-agent-secret`, ip: "192.168.2.50" },
    ];
    const report = async (observation: typeof observations[number], suffix: string) => {
      const discoveryId = `disc-collision-${observation.agentId}-${suffix}`;
      await pool().query("INSERT INTO discovery_sessions(id,tenant_id,agent_id,status) VALUES($1,$2,$3,'running')", [discoveryId, fixture.tenantId, observation.agentId]);
      return discoveryReport(new Request("https://gateway.test/api/agent/discovery", {
        method: "POST", headers: { Authorization: observation.auth, "Content-Type": "application/json" },
        body: JSON.stringify({ discoveryId, status: "completed", devices: [{ id: "same-local-id", stableId: "same-local-id", protocol: "ipp", ipAddress: observation.ip, port: 631 }] }),
      }));
    };
    const responses = await Promise.all(observations.map(o => report(o, "first")));
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    await pool().query("UPDATE discovered_devices SET candidate_status='verified',verification='verified' WHERE tenant_id=$1 AND agent_id=$2", [fixture.tenantId, secondAgent]);
    expect((await report({ ...observations[0], ip: "192.168.1.51" }, "next")).status).toBe(200);
    const rows = await pool().query("SELECT id,agent_id,ip_address,candidate_status FROM discovered_devices WHERE tenant_id=$1 ORDER BY ip_address", [fixture.tenantId]);
    expect(rows.rows).toEqual([
      { id: "same-local-id", agent_id: fixture.agentId, ip_address: "192.168.1.51", candidate_status: "discovered" },
      { id: "same-local-id", agent_id: secondAgent, ip_address: "192.168.2.50", candidate_status: "verified" },
    ]);
  });

  it("upgrades tenant-only observation uniqueness twice without changing retained evidence", async () => {
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      // A temporary pre-upgrade table shadows the worker table for this
      // transaction; the migration must resolve its own namespace correctly.
      await client.query("CREATE TEMP TABLE discovered_devices (tenant_id text,agent_id text,id text,candidate_status text,provisioned_printer_id text,CONSTRAINT discovered_devices_tenant_id_unique UNIQUE(tenant_id,id)) ON COMMIT DROP");
      await client.query("INSERT INTO discovered_devices VALUES('workspace','first-agent','retained-local-id','provisioned','retained-runtime-id')");
      const before = (await client.query("SELECT * FROM discovered_devices ORDER BY tenant_id,id")).rows;
      expect(before.length).toBeGreaterThan(0);
      const migration = readFileSync("drizzle/0097_agent_scoped_discovery_identity.sql", "utf8");
      await client.query(migration);
      await client.query(migration);
      expect((await client.query("SELECT * FROM discovered_devices ORDER BY tenant_id,id")).rows).toEqual(before);
      const constraint = await client.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='discovered_devices'::regclass AND conname='discovered_devices_tenant_agent_id_unique'");
      expect(constraint.rows).toEqual([{ definition: "UNIQUE (tenant_id, agent_id, id)" }]);
      await client.query("INSERT INTO discovered_devices VALUES('workspace','second-agent','retained-local-id','discovered',NULL)");
      await expect(client.query("INSERT INTO discovered_devices VALUES('workspace','first-agent','retained-local-id','discovered',NULL)")).rejects.toMatchObject({ code: "23505" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
