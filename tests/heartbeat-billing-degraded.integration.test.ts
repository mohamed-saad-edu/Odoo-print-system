import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { POST as heartbeatPOST } from "../src/app/api/agent/heartbeat/route";
import { hasTestDatabase, applyMigrations, truncateAll, seedFixture, closePool, pool } from "./helpers/pg";

const suite = describe.skipIf(!hasTestDatabase);

function makePrinter(id: string) {
  return {
    id, name: id, printerType: "physical", deviceClass: "other",
    connectionType: "network", protocol: "raw", status: "online",
    config: { ip: "10.0.0.10", port: 9100 },
    capabilities: { supported_protocols: ["raw"] },
  };
}

function heartbeat(agentAuth: string, body: unknown) {
  return heartbeatPOST(new Request("http://gateway.test/api/agent/heartbeat", {
    method: "POST",
    headers: { authorization: agentAuth, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

suite("heartbeat billing degradation (D-6)", () => {
  beforeAll(async () => { await applyMigrations(); });
  afterAll(async () => { await closePool(); });
  beforeEach(async () => { await truncateAll(); });

  it.each([undefined, null, {}, "unavailable", 42])("rejects malformed inventory %j without declaring existing printers absent", async (printers) => {
    const f = await seedFixture();
    const response = await heartbeat(f.agentAuth, {
      status: "online", heartbeatPage: 1, heartbeatPageCount: 1,
      inventorySnapshotId: "malformed-inventory", inventorySnapshotVersion: "1",
      inventoryComplete: true, printers,
    });
    expect.soft(response.status).toBe(400);
    const printer = (await pool().query("SELECT inventory_present,verification_state FROM printers WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.printerId])).rows[0];
    expect(printer).toMatchObject({ inventory_present: true, verification_state: "verified" });
  });

  it("commits presence and ACKs while fencing new inventory when billing lapsed", async () => {
    const f = await seedFixture();
    await pool().query(
      `UPDATE tenant_subscriptions SET status = 'suspended', current_period_end = now() - interval '1 minute' WHERE tenant_id = $1`,
      [f.tenantId],
    );
    const before = (await pool().query(`SELECT last_seen_at FROM agents WHERE id = $1`, [f.agentId])).rows[0].last_seen_at;
    const res = await heartbeat(f.agentAuth, {
      status: "online", printers: [makePrinter(f.printerId), makePrinter("printer_new_d6")],
      desiredStateAcks: [], gatewayOwnedPrinterIds: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; billingBlocked?: boolean; skippedPrinters?: Array<{ id: string; reason: string }> };
    expect(body.success).toBe(true);
    expect(body.billingBlocked).toBe(true);
    expect(body.skippedPrinters).toContainEqual({ id: "printer_new_d6", reason: "billing_required" });
    const after = (await pool().query(`SELECT last_seen_at, status FROM agents WHERE id = $1`, [f.agentId])).rows[0];
    expect(new Date(after.last_seen_at).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    expect(after.status).toBe("online");
    // Existing observation stays fresh even while billing is unresolved.
    const existing = (await pool().query(`SELECT inventory_present, status FROM printers WHERE tenant_id = $1 AND id = $2`, [f.tenantId, f.printerId])).rows[0];
    expect(existing).toMatchObject({ inventory_present: true, status: "online" });
    // Fenced printer was not inserted.
    expect((await pool().query(`SELECT id FROM printers WHERE tenant_id = $1 AND id = $2`, [f.tenantId, "printer_new_d6"])).rows).toHaveLength(0);
  });
});
