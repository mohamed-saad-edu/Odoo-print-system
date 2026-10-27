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

  it("converges concurrent registrations of expanded and compressed IPv6 endpoints", async () => {
    const f = await seedFixture();
    const manager = await createWorkspaceManagerTestSession(f.tenantId);
    const payload = { agentId: f.agentId, name: "IPv6 receipt printer", printerType: "physical",
      deviceClass: "thermal", connectionType: "network", protocol: "raw",
      config: { ip: "fd00:0:0:0:0:0:0:1", port: 9100 } };
    const [a, b] = await Promise.all([post(manager.token, payload),
      post(manager.token, { ...payload, config: { ip: "fd00::1", port: 9100 } })]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect((await a.json()).id).toBe((await b.json()).id);
    const rows = await pool().query("SELECT id FROM printers WHERE tenant_id=$1 AND name=$2",
      [f.tenantId, payload.name]);
    expect(rows.rows).toHaveLength(1);
  });

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

  it.each(["retired", "disabled", "unshared"] as const)(
    "never reports success for an existing %s printer endpoint",
    async (mode) => {
      const f = await seedFixture();
      const manager = await createWorkspaceManagerTestSession(f.tenantId);
      const payload = { agentId: f.agentId, name: "Reused local queue",
        printerType: "physical", deviceClass: "thermal",
        connectionType: "spooler", protocol: "spooler",
        config: { spooler_name: "Restricted POS Register" } };
      const created = await post(manager.token, payload);
      expect(created.status).toBe(201);
      const { id: printerId } = await created.json();
      await pool().query(
        "UPDATE printers SET lifecycle=$1, shared_with_gateway=$2 WHERE tenant_id=$3 AND id=$4",
        [mode === "unshared" ? "active" : mode, mode !== "unshared", f.tenantId, printerId],
      );
      const replay = await post(manager.token, payload);
      expect(replay.status).toBe(409);
      expect(await replay.json()).toMatchObject({ code: "PRINTER_ENDPOINT_CONFLICT" });
      const rows = await pool().query(
        "SELECT id,lifecycle,shared_with_gateway FROM printers WHERE tenant_id=$1 AND agent_id=$2 AND config->>'spooler_name'=$3",
        [f.tenantId, f.agentId, "Restricted POS Register"],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toMatchObject({
        id: printerId, lifecycle: mode === "unshared" ? "active" : mode,
        shared_with_gateway: mode !== "unshared",
      });
    },
  );

  it("refuses a requested printer ID already assigned to another physical queue", async () => {
    const f = await seedFixture();
    const manager = await createWorkspaceManagerTestSession(f.tenantId);
    const first = { id: "explicit-queue-a", agentId: f.agentId, name: "Queue A",
      printerType: "physical", deviceClass: "thermal",
      connectionType: "spooler", protocol: "spooler",
      config: { spooler_name: "Physical POS Queue A" } };
    const second = { ...first, id: "explicit-queue-b", name: "Queue B",
      config: { spooler_name: "Physical POS Queue B" } };
    expect((await post(manager.token, first)).status).toBe(201);
    expect((await post(manager.token, second)).status).toBe(201);

    // Reuse of a different existing printer's ID must not be silently
    // redirected to whichever physical endpoint happened to match first.
    const wrongBinding = await post(manager.token, { ...first, id: second.id });
    expect(wrongBinding.status).toBe(409);
    expect(await wrongBinding.json()).toMatchObject({ code: "PRINTER_ENDPOINT_CONFLICT" });
    const stored = await pool().query(
      "SELECT id, config->>'spooler_name' AS queue FROM printers WHERE tenant_id=$1 AND id IN ($2,$3) ORDER BY id",
      [f.tenantId, first.id, second.id],
    );
    expect(stored.rows).toEqual([
      { id: first.id, queue: first.config.spooler_name },
      { id: second.id, queue: second.config.spooler_name },
    ]);
    // A genuinely new Alias ID is still allowed to converge safely to
    // an existing endpoint; this case is specifically an occupied ID.
    const freshAlias = await post(manager.token, { ...first, id: "unused-queue-alias" });
    expect(freshAlias.status).toBe(200);
    expect((await freshAlias.json()).id).toBe(first.id);
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
