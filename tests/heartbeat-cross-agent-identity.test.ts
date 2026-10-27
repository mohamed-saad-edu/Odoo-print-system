import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { POST as heartbeatPOST } from "../src/app/api/agent/heartbeat/route";
import { hasTestDatabase, applyMigrations, truncateAll, seedFixture, closePool, pool } from "./helpers/pg";
import geometryFixtures from "../contracts/printer-geometry-fixtures.json";

const suite = describe.skipIf(!hasTestDatabase);

function makePrinter(id: string) {
  return {
    id,
    name: id,
    printerType: "physical",
    deviceClass: "other",
    connectionType: "network",
    protocol: "raw",
    status: "online",
    config: { ip: "10.0.0.10", port: 9100 },
    capabilities: { supported_protocols: ["raw"], geometry: { ...geometryFixtures.geometryCases[0].geometry, printer_id: id } },
  };
}

function heartbeat(agentAuth: string, printers: unknown[]) {
  return heartbeatPOST(new Request("http://gateway.test/api/agent/heartbeat", {
    method: "POST",
    headers: {
      authorization: agentAuth,
      "content-type": "application/json",
      "x-real-ip": "127.0.0.40",
    },
    body: JSON.stringify({
      status: "online",
      heartbeatPage: 1,
      heartbeatPageCount: 1,
      printers,
      desiredStateAcks: [],
      gatewayOwnedPrinterIds: [],
    }),
  }));
}

async function secondAgentSameTenant(tenantId: string): Promise<{ agentId: string; agentAuth: string }> {
  const agentId = `agt_${randomBytes(6).toString("base64url").slice(0, 8)}`;
  const agentSecret = randomBytes(16).toString("base64url");
  await pool().query(
    `INSERT INTO agents (id, tenant_id, name, secret, status, lifecycle, last_seen_at) VALUES ($1, $2, $3, $4, 'online', 'active', now())`,
    [agentId, tenantId, `Agent ${agentId}`, createHash("sha256").update(agentSecret).digest("hex")],
  );
  return { agentId, agentAuth: `Bearer ${agentId}:${agentSecret}` };
}

suite("heartbeat cross-agent printer identity", () => {
  beforeAll(async () => {
    await applyMigrations();
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("scopes colliding local discovery IDs per agent without dropping either device", async () => {
    const f = await seedFixture();
    await pool().query("DELETE FROM printers WHERE tenant_id = $1 AND id = $2", [f.tenantId, f.printerId]);
    const second = await secondAgentSameTenant(f.tenantId);
    const localId = "printer_net_deadbeef";

    const first = await heartbeat(f.agentAuth, [makePrinter(localId)]);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.printerIdAliases ?? {}).toEqual({});

    const res = await heartbeat(second.agentAuth, [makePrinter(localId)]);
    expect(res.status).toBe(200);
    const body = await res.json();
    const alias = body.printerIdAliases?.[localId] as string | undefined;
    expect(typeof alias).toBe("string");
    if (!alias) throw new Error("Expected colliding printer ID alias");
    expect(alias).not.toBe(localId);
    expect(alias.startsWith(`${localId}~`)).toBe(true);

    const rows = await pool().query(
      `SELECT id, agent_id, lifecycle, inventory_present FROM printers WHERE tenant_id = $1 ORDER BY id`,
      [f.tenantId],
    );
    expect(rows.rows.map((r: { id: string }) => r.id).sort()).toEqual([localId, alias].sort());
    const byId = new Map(rows.rows.map((r: { id: string; agent_id: string }) => [r.id, r.agent_id]));
    expect(byId.get(localId)).toBe(f.agentId);
    expect(byId.get(alias)).toBe(second.agentId);
    for (const row of rows.rows as Array<{ lifecycle: string; inventory_present: boolean }>) {
      expect(row.lifecycle).toBe("active");
      expect(row.inventory_present).toBe(true);
    }
    const aliasedGeometry = await pool().query("SELECT capabilities FROM printers WHERE tenant_id=$1 AND id=$2", [f.tenantId, alias]);
    expect(aliasedGeometry.rows[0].capabilities).not.toHaveProperty("geometry");

    // Reconnection stability: both agents heartbeat again, no duplicates,
    // no ownership flapping, same alias.
    const again = await heartbeat(second.agentAuth, [makePrinter(localId)]);
    expect(again.status).toBe(200);
    expect((await again.json()).printerIdAliases?.[localId]).toBe(alias);
    const firstAgain = await heartbeat(f.agentAuth, [makePrinter(localId)]);
    expect(firstAgain.status).toBe(200);
    expect((await firstAgain.json()).printerIdAliases ?? {}).toEqual({});
    const recount = await pool().query(`SELECT COUNT(*)::int AS n FROM printers WHERE tenant_id = $1`, [f.tenantId]);
    expect(Number(recount.rows[0]?.n)).toBe(2);

    // Only a new Agent observation under the adopted execution identity can
    // restore geometry; the Gateway never rewrites the original provenance.
    const adopted = await heartbeat(second.agentAuth, [makePrinter(alias)]);
    expect(adopted.status).toBe(200);
    const rebound = await pool().query("SELECT capabilities FROM printers WHERE tenant_id=$1 AND id=$2", [f.tenantId, alias]);
    expect(rebound.rows[0].capabilities.geometry.printer_id).toBe(alias);
  });

  it("denies an aliased cloud printer when its Agent reports its original local ID as private", async () => {
    const f = await seedFixture();
    await pool().query("DELETE FROM printers WHERE tenant_id = $1 AND id = $2", [f.tenantId, f.printerId]);
    const second = await secondAgentSameTenant(f.tenantId);
    const localId = "printer_net_private_collision";

    expect((await heartbeat(f.agentAuth, [makePrinter(localId)])).status).toBe(200);
    const created = await heartbeat(second.agentAuth, [makePrinter(localId)]);
    expect(created.status).toBe(200);
    const alias = (await created.json()).printerIdAliases?.[localId] as string | undefined;
    expect(alias).toMatch(/^printer_net_private_collision~[0-9a-f]{8}$/);

    const privateSnapshot = await heartbeatPOST(new Request("https://gateway.test/api/agent/heartbeat", {
      method: "POST", headers: { Authorization: second.agentAuth, "content-type": "application/json" },
      body: JSON.stringify({
        status: "online", heartbeatPage: 1, heartbeatPageCount: 1,
        inventorySnapshotId: "alias-private-snapshot", inventorySnapshotVersion: "100",
        inventoryComplete: true, privatePrinterIds: [localId], printers: [],
        desiredStateAcks: [], gatewayOwnedPrinterIds: [],
      }),
    }));
    expect(privateSnapshot.status).toBe(200);
    const rows = (await pool().query(
      "SELECT id,agent_id,shared_with_gateway,inventory_present FROM printers WHERE tenant_id=$1 AND id IN ($2,$3)",
      [f.tenantId, localId, alias],
    )).rows as Array<{ id:string;agent_id:string;shared_with_gateway:boolean;inventory_present:boolean }>;
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.id === localId)).toMatchObject({
      agent_id: f.agentId, shared_with_gateway: true, inventory_present: true,
    });
    expect(rows.find(row => row.id === alias)).toMatchObject({
      agent_id: second.agentId, shared_with_gateway: false, inventory_present: true,
    });
    // Unversioned legacy heartbeat cannot silently re-share the private alias.
    expect((await heartbeat(second.agentAuth, [makePrinter(localId)])).status).toBe(200);
    const after = await pool().query(
      "SELECT shared_with_gateway FROM printers WHERE tenant_id=$1 AND id=$2",
      [f.tenantId, alias],
    );
    expect(after.rows[0]?.shared_with_gateway).toBe(false);
  });

});
