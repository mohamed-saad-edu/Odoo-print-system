import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as registerPrinter } from "../src/app/api/printers/route";
import { POST as agentHeartbeat } from "../src/app/api/agent/heartbeat/route";
import { POST as deleteFleet } from "../src/app/api/platform/fleet/delete/route";
import { POST as deleteWorkspace } from "../src/app/api/platform/tenants/[id]/delete/route";
import { createWorkspaceManagerTestSession } from "./helpers/workspace-session";
import { createVerifiedPlatformSession as createPlatformSession } from "./helpers/platform-session";
import { gatewayTestSigningKey } from "./helpers/test-secrets";
import { physicalPrinterIdentityKey } from "../src/lib/physical-printer-identity";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll } from "./helpers/pg";

const suite = describe.skipIf(!hasTestDatabase);
const previousSecret = process.env.GATEWAY_JWT_SECRET;
const post = (route: string, token: string, data: unknown) => new Request(`http://gateway.test${route}`, {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

async function platformToken(): Promise<string> {
  const suffix = randomBytes(8).toString("hex");
  const userId = `platform-delete-${suffix}`;
  const email = `delete-${suffix}@platform.example.test`;
  await pool().query(`INSERT INTO users (id,email,password_hash,email_verified_at,is_platform_owner)
    VALUES ($1,$2,$3,now(),true)`, [userId, email, "testing-hash-not-used-for-login"]);
  return (await createPlatformSession(userId, email)).token;
}

suite("Platform Owner destructive actions preserve evidence and authorization", () => {
  beforeAll(async () => {
    process.env.GATEWAY_JWT_SECRET = gatewayTestSigningKey();
    await applyMigrations();
  });
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => {
    if (previousSecret === undefined) delete process.env.GATEWAY_JWT_SECRET;
    else process.env.GATEWAY_JWT_SECRET = previousSecret;
    await closePool();
  });

  it("removes a printer without losing accepted job history or allowing automatic resurrection", async () => {
    const f = await seedFixture();
    const manager = await createWorkspaceManagerTestSession(f.tenantId);
    const platform = await platformToken();
    const submitted = await registerPrinter(post("/api/printers", manager.token, {
      agentId: f.agentId, name: "Thermal sales", printerType: "physical",
      deviceClass: "thermal", connectionType: "spooler", protocol: "spooler",
      config: { spooler_name: "Owner Sales Queue" },
    }));
    expect(submitted.status).toBe(201);
    const printer = await submitted.json() as { id: string };
    const jobId = "platform-remove-printer-job";
    await pool().query(`INSERT INTO print_jobs
      (id,tenant_id,agent_id,printer_id,destination,document_type,status,payload,expires_at)
      VALUES ($1,$2,$3,$4,'POS','receipt','queued',
      '{"type":"raw","protocol":"raw","encoding":"base64","data":"aGVsbG8="}'::jsonb,
      now() + interval '1 hour')`,
      [jobId, f.tenantId, f.agentId, printer.id]);

    const removal = await deleteFleet(post("/api/platform/fleet/delete", platform, {
      kind: "printers", tenantId: f.tenantId, id: printer.id,
      expectedLifecycle: "active", confirmId: printer.id,
      reason: "Operator explicitly retired this duplicate physical queue",
    }));
    expect(removal.status).toBe(200);
    const dbRow = (await pool().query("SELECT lifecycle,shared_with_gateway,physical_identity_key FROM printers WHERE tenant_id=$1 AND id=$2",
      [f.tenantId, printer.id])).rows[0];
    expect(dbRow).toMatchObject({ lifecycle: "retired", shared_with_gateway: false });
    expect(dbRow.physical_identity_key).toMatch(/^v2:[0-9a-f]{64}$/);
    expect(dbRow.physical_identity_key).toBe(physicalPrinterIdentityKey({
      connectionType: "spooler", protocol: "spooler", config: { spooler_name: "Owner Sales Queue" },
    }));
    expect((await pool().query("SELECT id FROM print_jobs WHERE id=$1", [jobId])).rows).toHaveLength(0);
    const receipt = (await pool().query("SELECT status,error,printer_id FROM print_job_receipts WHERE id=$1", [jobId])).rows[0];
    expect(receipt.status).toBe("failed");
    expect(receipt.error).toMatch(/^PRINTER_REMOVED:/);
    expect(receipt.printer_id).toBe(printer.id);

    const observed = await agentHeartbeat(post("/api/agent/heartbeat", f.agentAuth.slice(7), {
      status: "online", printers: [{
        id: "new-id-after-removal", name: "Rediscovered sales queue", printerType: "physical",
        deviceClass: "thermal", connectionType: "spooler", protocol: "spooler",
        status: "online", config: { spooler_name: "owner SALES queue" },
        capabilities: { supported_protocols: ["spooler"] },
      }], desiredStateAcks: [], gatewayOwnedPrinterIds: [],
    }));
    expect(observed.status).toBe(200);
    expect((await observed.json()).skippedPrinters).toEqual(expect.arrayContaining([
      { id: "new-id-after-removal", reason: `duplicate_physical_endpoint_registered_as_${printer.id}` },
    ]));
    expect((await pool().query("SELECT id FROM printers WHERE tenant_id=$1 AND id='new-id-after-removal'", [f.tenantId])).rows).toEqual([]);
  });

  it("physically deletes Agent inventory and retains payload-free accepted-job receipts", async () => {
    const f = await seedFixture();
    const platform = await platformToken();
    const jobId = "platform-remove-agent-job";
    await pool().query(`INSERT INTO print_jobs
      (id,tenant_id,agent_id,printer_id,destination,document_type,status,payload,expires_at)
      VALUES ($1,$2,$3,$4,'POS','receipt','queued',
      '{"type":"raw","protocol":"raw","encoding":"base64","data":"aGVsbG8="}'::jsonb,
      now() + interval '1 hour')`,
      [jobId, f.tenantId, f.agentId, f.printerId]);
    const response = await deleteFleet(post("/api/platform/fleet/delete", platform, {
      kind: "agents", tenantId: f.tenantId, id: f.agentId, expectedLifecycle: "active",
      confirmId: f.agentId, reason: "Operator deleted a decommissioned Agent",
    }));
    expect(response.status).toBe(200);
    expect((await pool().query("SELECT id FROM agents WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.agentId])).rows).toHaveLength(0);
    expect((await pool().query("SELECT id FROM printers WHERE tenant_id=$1 AND agent_id=$2", [f.tenantId, f.agentId])).rows).toHaveLength(0);
    expect((await pool().query("SELECT id FROM print_jobs WHERE id=$1", [jobId])).rows).toHaveLength(0);
    const receipt = (await pool().query("SELECT status,error FROM print_job_receipts WHERE id=$1", [jobId])).rows[0];
    expect(receipt.status).toBe("failed");
    expect(receipt.error).toMatch(/^AGENT_DELETED:/);
  });

  it("deletes a workspace through authenticated lifecycle fencing and prevents activation replay", async () => {
    const f = await seedFixture();
    const platform = await platformToken();
    const payload = { confirmId: f.tenantId, reason: "Customer requested permanent workspace closure" };
    const endpoint = `/api/platform/tenants/${encodeURIComponent(f.tenantId)}/delete`;
    const context = { params: Promise.resolve({ id: f.tenantId }) };
    const missingConfirmation = await deleteWorkspace(post(endpoint, platform, { ...payload, confirmId: "wrong" }), context);
    expect(missingConfirmation.status).toBe(400);
    const removal = await deleteWorkspace(post(endpoint, platform, payload), context);
    expect(removal.status).toBe(200);
    const row = (await pool().query("SELECT lifecycle,deleted_at FROM tenants WHERE id=$1", [f.tenantId])).rows[0];
    expect(row.lifecycle).toBe("deleted");
    expect(row.deleted_at).not.toBeNull();
    const again = await deleteWorkspace(post(endpoint, platform, payload), context);
    expect(again.status).toBe(409);
  });
});
