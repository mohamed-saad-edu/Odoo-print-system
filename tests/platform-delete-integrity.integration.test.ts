import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as registerPrinter } from "../src/app/api/printers/route";
import { POST as agentHeartbeat } from "../src/app/api/agent/heartbeat/route";
import { POST as deleteFleet } from "../src/app/api/platform/fleet/delete/route";
import { POST as changeFleetLifecycle } from "../src/app/api/platform/fleet/lifecycle/route";
import { POST as deleteWorkspace } from "../src/app/api/platform/tenants/[id]/delete/route";
import { GET as readJob } from "../src/app/api/jobs/[id]/route";
import { PATCH as reportJob } from "../src/app/api/agent/jobs/route";
import { createWorkspaceManagerTestSession } from "./helpers/workspace-session";
import { createVerifiedPlatformSession as createPlatformSession } from "./helpers/platform-session";
import { gatewayTestSigningKey } from "./helpers/test-secrets";
import { physicalPrinterIdentityKey } from "../src/lib/physical-printer-identity";
import { removeFleetItem } from "../src/lib/platform-fleet-deletion";
import { verifyPlatformTokenSignature } from "../src/lib/platform-auth";
import { transitionTenantLifecycle } from "../src/lib/tenant-lifecycle";
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

  it.each([
    ["remove", "printers"], ["remove", "agents"],
    ["disable", "printers"], ["disable", "agents"],
  ] as const)("serializes %s %s with a concurrent Workspace suspension", async (operation, kind) => {
    const f = await seedFixture();
    const token = await platformToken();
    const actor = verifyPlatformTokenSignature(token)!;
    const id = kind === "agents" ? f.agentId : f.printerId;
    const blocker = await pool().connect();
    const blockerPid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
    const waitForBlockedTransactions = async (count: number) => {
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        // Observe actual PostgreSQL waits in this worker's schema. There is no
        // timing guess: release the actor only after both operations are queued.
        const waiting = await pool().query(`SELECT DISTINCT a.pid FROM pg_stat_activity a
          JOIN pg_locks l ON l.pid=a.pid
          WHERE a.pid<>$1 AND a.wait_event_type='Lock'
            AND l.relation IN ('users'::regclass,'tenants'::regclass)
            AND cardinality(pg_blocking_pids(a.pid))>0`, [blockerPid]);
        if (waiting.rows.length >= count) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`Expected ${count} queued control-plane transactions`);
    };
    const settled = <T,>(operation: Promise<T>) => operation.then(
      value => ({ ok: true as const, value }), error => ({ ok: false as const, error }),
    );
    let fleet: ReturnType<typeof settled<{ status: number }>> | undefined;
    let workspace: ReturnType<typeof settled<Awaited<ReturnType<typeof transitionTenantLifecycle>>>> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [actor.userId]);
      fleet = settled<{ status: number }>(operation === "remove"
        ? removeFleetItem({ kind, tenantId: f.tenantId, id, expectedLifecycle: "active", reason: "Concurrent retirement", actor })
        : changeFleetLifecycle(post("/api/platform/fleet/lifecycle", token, {
          kind, tenantId: f.tenantId, id, expectedLifecycle: "active", nextLifecycle: "disabled", reason: "Concurrent disablement",
        })));
      await waitForBlockedTransactions(1);
      workspace = settled(transitionTenantLifecycle(f.tenantId, "suspended", "Concurrent Workspace suspension", {
        type: "platform", id: actor.userId, claims: actor,
      }));
      await waitForBlockedTransactions(2);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      // Drain both real transactions even if observing a wait failed.
      await Promise.all([fleet, workspace]);
    }
    expect(await fleet).toMatchObject({ ok: true, value: { status: 200 } });
    expect(await workspace).toMatchObject({ ok: true, value: { lifecycle: "suspended" } });
    expect((await pool().query("SELECT lifecycle FROM tenants WHERE id=$1", [f.tenantId])).rows[0].lifecycle).toBe("suspended");
  });

  it.each(["remove", "disable"] as const)("still permits %s in a suspended Workspace", async operation => {
    const f = await seedFixture();
    const token = await platformToken();
    await pool().query("UPDATE tenants SET lifecycle='suspended' WHERE id=$1", [f.tenantId]);
    const route = operation === "remove" ? deleteFleet : changeFleetLifecycle;
    const response = await route(post(`/api/platform/fleet/${operation === "remove" ? "delete" : "lifecycle"}`, token, {
      kind: "printers", tenantId: f.tenantId, id: f.printerId, expectedLifecycle: "active",
      ...(operation === "remove" ? { confirmId: f.printerId } : { nextLifecycle: "disabled" }),
      reason: "Retire unused device while Workspace remains suspended",
    }));
    expect(response.status).toBe(200);
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

  it.each(["printers", "agents"] as const)("retains verified file-output evidence and binding after removing %s", async (kind) => {
    const f = await seedFixture();
    const platform = await platformToken();
    const manager = await createWorkspaceManagerTestSession(f.tenantId);
    const config = { output_profile_id: "office_archive" };
    const bindingDigest = "a".repeat(64);
    const evidence = { output_medium: "file", artifact_id: "archived-pdf-result", sha256: "b".repeat(64), page_count: 2, bytes: 4096 };
    const claimToken = "original-file-output-claim";
    const claimHash = createHash("sha256").update(claimToken).digest("hex");
    await pool().query(`UPDATE printers SET printer_type='file',connection_type='pdf_output',
      protocol='pdf',output_medium='file',config=$1::jsonb,physical_identity_key=$2
      WHERE tenant_id=$3 AND id=$4`, [JSON.stringify(config), physicalPrinterIdentityKey({
      connectionType: "pdf_output", protocol: "pdf", config,
    }), f.tenantId, f.printerId]);
    const jobId = `retained-file-${kind}`;
    await pool().query(`INSERT INTO print_jobs
      (id,tenant_id,agent_id,printer_id,destination,document_type,status,payload,expires_at,
       output_medium,output_evidence,binding_digest,closed_claim_token_hash)
      VALUES ($1,$2,$3,$4,'archive','invoice','success',
       '{"type":"pdf","encoding":"base64","data":"JVBERi0xLjQKJSVFT0Y="}'::jsonb,
       now()+interval '1 hour','file',$5::jsonb,$6,$7)`,
      [jobId, f.tenantId, f.agentId, f.printerId, JSON.stringify(evidence), bindingDigest, claimHash]);
    const id = kind === "agents" ? f.agentId : f.printerId;
    const removed = await deleteFleet(post("/api/platform/fleet/delete", platform, {
      kind, tenantId: f.tenantId, id, expectedLifecycle: "active", confirmId: id,
      reason: "Retire inventory while preserving the previously verified PDF result",
    }));
    expect(removed.status).toBe(200);
    expect((await pool().query("SELECT id FROM print_jobs WHERE id=$1", [jobId])).rows).toEqual([]);
    const receipt = (await pool().query(`SELECT status,output_medium,output_evidence,binding_digest,
      closed_claim_token_hash FROM print_job_receipts WHERE id=$1`, [jobId])).rows[0];
    expect(receipt).toEqual({ status: "success", output_medium: "file", output_evidence: evidence,
      binding_digest: bindingDigest, closed_claim_token_hash: claimHash });
    const response = await readJob(new Request(`http://gateway.test/api/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${manager.token}` },
    }), { params: Promise.resolve({ id: jobId }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ archived: true, status: "success",
      outputMedium: "file", outputOutcome: "file_created", physicalOutcome: "unknown",
      outputEvidence: evidence, diagnosticPayload: null });
    if (kind === "printers") {
      const replay = await reportJob(new Request("http://gateway.test/api/agent/jobs", {
        method: "PATCH", headers: { Authorization: f.agentAuth, "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, status: "success", claimToken, outputEvidence: evidence }),
      }));
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ outputMedium: "file", outputOutcome: "file_created", outputEvidence: evidence });
    }
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
