import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { POST as registerPrinter } from "../src/app/api/printers/route";
import { POST as agentHeartbeat } from "../src/app/api/agent/heartbeat/route";
import { DELETE as removeOdooKey } from "../src/app/api/odoo/keys/route";
import { GET as listOdooPrinters } from "../src/app/api/odoo/printers/route";
import { createWorkspaceManagerTestSession } from "./helpers/workspace-session";
import { gatewayTestSigningKey } from "./helpers/test-secrets";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll, sha256 } from "./helpers/pg";

const suite = describe.skipIf(!hasTestDatabase);
const previousKey = process.env.GATEWAY_JWT_SECRET;
suite("physical endpoint convergence and credential-row erasure", () => {
  beforeAll(async () => {
    process.env.GATEWAY_JWT_SECRET = gatewayTestSigningKey();
    await applyMigrations();
  });
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => {
    if (previousKey === undefined) delete process.env.GATEWAY_JWT_SECRET;
    else process.env.GATEWAY_JWT_SECRET = previousKey;
    await closePool();
  });

  const post = (token: string, payload: unknown) => registerPrinter(new Request("http://gateway.test/api/printers", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));

  it("converges two simultaneous manager registrations of the same physical Windows queue", async () => {
    const f = await seedFixture();
    const manager = await createWorkspaceManagerTestSession(f.tenantId);
    const payload = { agentId: f.agentId, name: "Kitchen Queue", printerType: "physical",
      deviceClass: "thermal", connectionType: "spooler", protocol: "spooler",
      config: { spooler_name: "Receipt Thermal 80mm" } };
    const [a, b] = await Promise.all([post(manager.token, payload),
      post(manager.token, { ...payload, name: "Renamed Kitchen Queue" })]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    const first = await a.json(), second = await b.json();
    expect(first.id).toBe(second.id);
    expect(new Set([first.already, second.already])).toEqual(new Set([false, true]));
    const rows = await pool().query(
      `SELECT id, management_source, physical_identity_key
       FROM printers WHERE tenant_id = $1 AND agent_id = $2 AND config->>'spooler_name' = $3`,
      [f.tenantId, f.agentId, "Receipt Thermal 80mm"],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].physical_identity_key).toMatch(/^v2:[0-9a-f]{64}$/);
  });

  it("does not register an Agent discovery duplicate of an existing manager queue", async () => {
    const f = await seedFixture();
    const manager = await createWorkspaceManagerTestSession(f.tenantId);
    const payload = { agentId: f.agentId, name: "Real Windows Queue",
      printerType: "physical", deviceClass: "thermal", connectionType: "spooler",
      protocol: "spooler", config: { spooler_name: "Sales Register" } };
    const manuallyAdded = await post(manager.token, payload);
    expect(manuallyAdded.status).toBe(201);
    const canonical = await manuallyAdded.json();
    const observation = await agentHeartbeat(new Request("http://gateway.test/api/agent/heartbeat", {
      method: "POST", headers: { Authorization: f.agentAuth, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "online", printers: [{
        id: "new-discovered-id", name: "Auto discovered", printerType: "physical",
        deviceClass: "thermal", connectionType: "spooler", protocol: "spooler",
        status: "online", config: { spooler_name: "SALES REGISTER" },
        capabilities: { supported_protocols: ["spooler"] },
      }], desiredStateAcks: [], gatewayOwnedPrinterIds: [] }),
    }));
    expect(observation.status).toBe(200);
    const body = await observation.json();
    expect(body.skippedPrinters).toEqual(expect.arrayContaining([
      { id: "new-discovered-id", reason: `duplicate_physical_endpoint_registered_as_${canonical.id}` },
    ]));
    const rows = await pool().query(`SELECT id, management_source FROM printers
      WHERE tenant_id = $1 AND agent_id = $2 AND lower(config->>'spooler_name') = 'sales register'`,
      [f.tenantId, f.agentId]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].id).toBe(canonical.id);
    expect(rows.rows[0].management_source).toBe("manager");
  });

  it("physically removes an Odoo API credential and its binding but preserves accepted print history", async () => {
    const f = await seedFixture();
    const manager = await createWorkspaceManagerTestSession(f.tenantId);
    const keyRow = await pool().query("SELECT id FROM api_keys WHERE tenant_id=$1 AND hashed_key=$2",
      [f.tenantId, sha256(f.odooKey)]);
    expect(keyRow.rows).toHaveLength(1);
    const keyId = keyRow.rows[0].id as string;
    const installationId = "integration-acceptance";
    await pool().query("INSERT INTO odoo_installations(id,tenant_id,name,secret_hash) VALUES ($1,$2,$3,$4)",
      [installationId, f.tenantId, "Odoo installation", sha256("enrollment-proof")]);
    await pool().query("INSERT INTO odoo_installation_credentials(tenant_id,installation_id,api_key_id) VALUES ($1,$2,$3)",
      [f.tenantId, installationId, keyId]);
    await pool().query(`INSERT INTO print_jobs
      (id,tenant_id,agent_id,printer_id,api_key_id,destination,document_type,status,payload,expires_at,binding_digest)
      VALUES ('history-key-removal', $1, $2, $3, $4, 'POS', 'receipt', 'queued',
      '{"type":"raw","protocol":"raw","encoding":"base64","data":"aGVsbG8="}'::jsonb,
      now() + interval '1 hour', (SELECT verification_binding_digest FROM printers WHERE tenant_id=$1 AND id=$3))`, [f.tenantId, f.agentId, f.printerId, keyId]);
    const removed = await removeOdooKey(new Request("http://gateway.test/api/odoo/keys", {
      method: "DELETE", headers: { Authorization: "Bearer " + manager.token, "Content-Type": "application/json" },
      body: JSON.stringify({ id: keyId, remove: true }),
    }));
    expect(removed.status).toBe(200);
    expect((await pool().query("SELECT id FROM api_keys WHERE id=$1", [keyId])).rows).toEqual([]);
    expect((await pool().query("SELECT api_key_id FROM odoo_installation_credentials WHERE api_key_id=$1", [keyId])).rows).toEqual([]);
    expect((await pool().query("SELECT api_key_id FROM print_jobs WHERE id='history-key-removal'")).rows[0]?.api_key_id).toBe(keyId);
    const denied = await listOdooPrinters(new Request("http://gateway.test/api/odoo/printers", {
      headers: { Authorization: "Bearer " + f.odooKey },
    }));
    expect(denied.status).toBe(401);
  });
});
