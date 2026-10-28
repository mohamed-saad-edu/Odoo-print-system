import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { gatewayTestSigningKey } from "./helpers/test-secrets";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll, type Fixture } from "./helpers/pg";
import { createWorkspaceManagerTestSession } from "./helpers/workspace-session";
import { POST as provisionPOST } from "../src/app/api/agents/[id]/discovered-printers/[deviceId]/provision/route";

describe.skipIf(!hasTestDatabase)("provisioned discovery identity remains bound to the approved endpoint", () => {
  let fixture: Fixture;
  beforeAll(async () => {
    process.env.GATEWAY_JWT_SECRET = gatewayTestSigningKey();
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    fixture = await seedFixture();
  });
  afterAll(async () => {
    await closePool();
    delete process.env.GATEWAY_JWT_SECRET;
  });

  it.each([
    {
      transport: "network", protocol: "raw",
      approved: { ip: "192.168.88.10", port: 9100 },
      changed: { ip: "192.168.88.11", port: 9100 },
      ip: "192.168.88.10", port: 9100, uri: null, spooler: null,
    },
    {
      transport: "ipp", protocol: "ipp",
      approved: { address: "ipp://192.168.88.10:631/ipp/print" },
      changed: { address: "ipp://192.168.88.10:631/other-queue" },
      ip: "192.168.88.10", port: 631,
      uri: "ipp://192.168.88.10:631/ipp/print", spooler: null,
    },
    {
      transport: "spooler", protocol: "spooler",
      approved: { spooler_name: "Queue Alpha", address: "Queue Alpha" },
      changed: { spooler_name: "Queue Beta", address: "Queue Beta" },
      ip: null, port: null, uri: null, spooler: "Queue Alpha",
    },
  ] as const)("denies a stale $transport approval after the printer target changes", async (example) => {
    const discoveryId = "disc_endpoint_drift";
    const deviceId = "candidate_endpoint_drift";
    await pool().query(
      "UPDATE printers SET connection_type=$1,protocol=$2,config=$3::jsonb WHERE tenant_id=$4 AND agent_id=$5 AND id=$6",
      [example.transport, example.protocol, JSON.stringify(example.approved), fixture.tenantId, fixture.agentId, fixture.printerId],
    );
    await pool().query(
      "INSERT INTO discovery_sessions(id,tenant_id,agent_id,status,config,stats) VALUES ($1,$2,$3,'completed','{}'::jsonb,'{}'::jsonb)",
      [discoveryId, fixture.tenantId, fixture.agentId],
    );
    await pool().query(
      `INSERT INTO discovered_devices
        (id,tenant_id,agent_id,discovery_id,protocol,ip_address,port,uri,spooler_name,device_name,verification,candidate_status,provisioned_printer_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'verified','provisioned',$11)`,
      [deviceId, fixture.tenantId, fixture.agentId, discoveryId, example.protocol, example.ip, example.port,
        example.uri, example.spooler, example.spooler, fixture.printerId],
    );
    const manager = await createWorkspaceManagerTestSession(fixture.tenantId);
    const replay = () => provisionPOST(
      new Request("http://gateway.test/api/agents/provision", {
        method: "POST", headers: { Authorization: `Bearer ${manager.token}` },
      }),
      { params: Promise.resolve({ id: fixture.agentId, deviceId }) },
    );

    const valid = await replay();
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ printerId: fixture.printerId, already: true });

    // The operator may change the backend/queue without changing its DB ID.
    // Old discovery approval must never silently adopt that different target.
    await pool().query(
      "UPDATE printers SET config=$1::jsonb WHERE tenant_id=$2 AND agent_id=$3 AND id=$4",
      [JSON.stringify(example.changed), fixture.tenantId, fixture.agentId, fixture.printerId],
    );
    const stale = await replay();
    expect(stale.status).toBe(422);
    expect((await stale.json()).code).toBe("INVALID_PRINTER_ENDPOINT");
    const persisted = await pool().query(
      "SELECT candidate_status,provisioned_printer_id FROM discovered_devices WHERE tenant_id=$1 AND agent_id=$2 AND id=$3",
      [fixture.tenantId, fixture.agentId, deviceId],
    );
    expect(persisted.rows).toEqual([{ candidate_status: "provisioned", provisioned_printer_id: fixture.printerId }]);
    expect((await pool().query("SELECT count(*)::int AS count FROM printers WHERE tenant_id=$1", [fixture.tenantId])).rows[0].count).toBe(1);
  });
});
