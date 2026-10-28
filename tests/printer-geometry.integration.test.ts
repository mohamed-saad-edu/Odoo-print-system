import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PATCH as patchPrinter } from "../src/app/api/printers/[id]/route";
import { POST as heartbeat } from "../src/app/api/agent/heartbeat/route";
import { POST as reportDiscovery } from "../src/app/api/agent/discovery/route";
import { GET as listPrinters } from "../src/app/api/odoo/printers/route";
import { POST as printJob } from "../src/app/api/print/jobs/route";
import { createWorkspaceManagerTestSession } from "./helpers/workspace-session";
import { gatewayTestSigningKey } from "./helpers/test-secrets";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll, type Fixture } from "./helpers/pg";
import geometryFixtures from "../contracts/printer-geometry-fixtures.json";

const suite = describe.skipIf(!hasTestDatabase);
const previousKey = process.env.GATEWAY_JWT_SECRET;
const example = geometryFixtures.geometryCases.find((entry) => entry.name === "physical-1664-dots-600-dpi-80-mm")!.geometry;

suite("printer geometry at authenticated database boundaries", () => {
  let fixture: Fixture;
  const geometry = (patch: Record<string, unknown> = {}) => ({ ...example, printer_id: fixture.printerId, ...patch });
  const operational = () => ({ version: 1, verified_at: new Date().toISOString(), printer_id: fixture.printerId,
    binding_digest: "a".repeat(64), logical_queue_key: "a".repeat(64), method: "windows_queue", identity_strength: "queue", output_medium: "physical" });
  const profile = { printable_width_dots: 1664, dpi_x: 600, dpi_y: 600, paper_width_mm: 80, raster_command: "gs_v_0" };
  beforeAll(async () => { process.env.GATEWAY_JWT_SECRET = gatewayTestSigningKey(); await applyMigrations(); });
  beforeEach(async () => {
    await truncateAll(); fixture = await seedFixture();
    await pool().query("UPDATE printers SET config=$1::jsonb WHERE tenant_id=$2 AND id=$3", [
      JSON.stringify({ spooler_name: "Measured receipt queue" }), fixture.tenantId, fixture.printerId,
    ]);
  });
  afterAll(async () => {
    if (previousKey === undefined) delete process.env.GATEWAY_JWT_SECRET;
    else process.env.GATEWAY_JWT_SECRET = previousKey;
    await closePool();
  });

  async function installGeometry(patch: Record<string, unknown> = {}) {
    // A validated_profile is authoritative only for the exact configured
    // printer profile. The old fixture injected capability JSON without any
    // matching desired profile, so the production API correctly suppressed
    // the geometry and 422'd image admission.
    const measurement = geometry(patch) as Record<string, unknown>;
    const profileFields = ["printable_width_dots", "printable_height_dots", "dpi_x", "dpi_y",
      "paper_width_mm", "paper_height_mm", "offset_x_dots", "offset_y_dots", "raster_command"];
    const selectedProfile = Object.fromEntries(profileFields.filter(key => key in measurement)
      .map(key => [key, measurement[key]]));
    await pool().query("UPDATE printers SET capabilities=COALESCE(capabilities,'{}'::jsonb) || $1::jsonb, config=COALESCE(config,'{}'::jsonb) || $2::jsonb WHERE tenant_id=$3 AND id=$4", [
      JSON.stringify({ supported_protocols: ["pdf", "image"], geometry: measurement }),
      JSON.stringify({ geometry_profile: selectedProfile }), fixture.tenantId, fixture.printerId,
    ]);
  }
  async function inventory() {
    const response = await listPrinters(new Request("https://gateway.test/api/odoo/printers", { headers: { Authorization: "Bearer " + fixture.odooKey } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    return body.printers.find((printer: { id: string }) => printer.id === fixture.printerId);
  }
  function patch(token: string, value: unknown) {
    return patchPrinter(new Request("https://gateway.test/api/printers/" + fixture.printerId, {
      method: "PATCH", headers: { Authorization: token, "Content-Type": "application/json" }, body: JSON.stringify(value),
    }), { params: Promise.resolve({ id: fixture.printerId }) });
  }
  function submit(key: string, fingerprint: string | null = example.config_fingerprint) {
    return printJob(new Request("https://gateway.test/api/print/jobs", {
      method: "POST", headers: { Authorization: "Bearer " + fixture.odooKey, "Content-Type": "application/json" },
      body: JSON.stringify({ printerId: fixture.printerId, destination: "POS", documentType: "receipt", idempotencyKey: key,
        payload: { type: "image", encoding: "base64", data: "/9j/4AAQSkZJRg==", ...(fingerprint ? { geometry_fingerprint: fingerprint } : {}) } }),
    }));
  }

  it("publishes a full high-DPI profile and preserves its exact fingerprint in a new job", async () => {
    await installGeometry();
    expect(await inventory()).toMatchObject({ printableWidthDots: 1664, capabilities: { geometry: geometry(), supported_protocols: ["pdf", "image"] } });
    const response = await submit("geometry-job-new");
    expect(response.status).toBe(201);
    const accepted = await response.json();
    const row = await pool().query("SELECT payload FROM print_jobs WHERE id=$1 AND tenant_id=$2", [accepted.jobId, fixture.tenantId]);
    expect(row.rows[0].payload.geometry_fingerprint).toBe(example.config_fingerprint);
  });

  it("rejects a stale fingerprint at new admission while reconciling the exact accepted operation", async () => {
    await installGeometry();
    const first = await submit("geometry-old-accepted");
    expect(first.status).toBe(201);
    const accepted = await first.json();
    await installGeometry({ config_fingerprint: "b".repeat(64), dpi_y: 300 });
    const stale = await submit("geometry-old-new-job");
    expect(stale.status).toBe(422);
    expect(await stale.json()).toMatchObject({ code: "CAPABILITY_MISMATCH", error: expect.stringContaining("GEOMETRY_CHANGED") });
    const replay = await submit("geometry-old-accepted");
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ jobId: accepted.jobId });
    expect((await pool().query("SELECT count(*)::int AS count FROM print_jobs WHERE tenant_id=$1", [fixture.tenantId])).rows[0].count).toBe(1);
  });

  it("reconciles an old accepted image without a fingerprint but rejects a new one", async () => {
    await installGeometry();
    const first = await submit("geometry-legacy-accepted");
    expect(first.status).toBe(201);
    const accepted = await first.json();
    // The pre-v1 durable representation has no geometry fingerprint. It is
    // historical state, never a template for creating an unbound new job.
    await pool().query("UPDATE print_jobs SET payload=payload - 'geometry_fingerprint' WHERE id=$1 AND tenant_id=$2", [accepted.jobId, fixture.tenantId]);
    const replay = await submit("geometry-legacy-accepted", null);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ jobId: accepted.jobId });
    expect((await submit("geometry-unbound-new", null)).status).toBe(422);
  });

  it("manager profile changes clear geometry and wait for applied and observed convergence", async () => {
    await installGeometry();
    const manager = await createWorkspaceManagerTestSession(fixture.tenantId);
    const changedProfile = { ...profile, printable_width_dots: 832, dpi_x: 300, dpi_y: 300 };
    const response = await patch("Bearer " + manager.token, { config: { geometry_profile: changedProfile } });
    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated.config.geometry_profile).toEqual(changedProfile);
    expect(updated.capabilities).not.toHaveProperty("geometry");
    expect(await inventory()).toBeUndefined();
    await installGeometry({ ...changedProfile, config_fingerprint: "b".repeat(64) });
    await pool().query("UPDATE printers SET applied_desired_revision=desired_revision, observed_desired_revision=GREATEST(0,desired_revision-1) WHERE tenant_id=$1 AND id=$2", [fixture.tenantId, fixture.printerId]);
    expect(await inventory()).toBeUndefined();
    await pool().query("UPDATE printers SET observed_desired_revision=desired_revision WHERE tenant_id=$1 AND id=$2", [fixture.tenantId, fixture.printerId]);
    expect(await inventory()).toBeUndefined(); // Revision ACK alone is not a successful live probe.
    await pool().query("UPDATE printers SET verification_state='verified',verification_verified_at=clock_timestamp(),verification_received_at=clock_timestamp(),verification_binding_digest=logical_queue_key,verification_reason=NULL WHERE tenant_id=$1 AND id=$2", [fixture.tenantId, fixture.printerId]);
    expect((await inventory()).printableWidthDots).toBe(832);
    const removed = await patch("Bearer " + manager.token, { config: { geometry_profile: null } });
    expect(removed.status).toBe(200);
    const removedBody = await removed.json();
    expect(removedBody.config).not.toHaveProperty("geometry_profile");
    expect(removedBody.capabilities).not.toHaveProperty("geometry");
  });

  it("does not accept observed capability writes or malformed profiles through manager desired state", async () => {
    const manager = await createWorkspaceManagerTestSession(fixture.tenantId);
    for (const body of [{ capabilities: { geometry: geometry() } }, { config: { geometry_profile: { dpi_x: 600 } } },
      { config: { geometry_profile: { ...profile, printable_width_dots: 17000 } } },
      { config: { geometry_profile: { ...profile, paper_width_mm: 10 } } },
      { config: { geometry_profile: { ...profile, source: "windows_driver" } } }]) {
      expect((await patch("Bearer " + manager.token, body)).status).toBe(400);
    }
    expect((await patch(fixture.agentAuth, { config: { geometry_profile: profile } })).status).toBe(403);
    const row = await pool().query("SELECT config FROM printers WHERE tenant_id=$1 AND id=$2", [fixture.tenantId, fixture.printerId]);
    expect(row.rows[0].config).not.toHaveProperty("geometry_profile");
  });

  it("hides stale configured measurements even after an ACK claims convergence", async () => {
    await installGeometry();
    await pool().query("UPDATE printers SET management_source='manager',desired_revision=2,applied_desired_revision=2,observed_desired_revision=2,config=config || $1::jsonb WHERE tenant_id=$2 AND id=$3", [
      JSON.stringify({ geometry_profile: { ...profile, dpi_y: 300 } }), fixture.tenantId, fixture.printerId,
    ]);
    expect((await inventory()).printableWidthDots).toBeNull();
    expect((await submit("geometry-profile-mismatch")).status).toBe(422);
  });

  it("drops malformed heartbeat geometry without removing ordinary driver PDF capability", async () => {
    const row = (await pool().query("SELECT * FROM printers WHERE tenant_id=$1 AND id=$2", [fixture.tenantId, fixture.printerId])).rows[0];
    const response = await heartbeat(new Request("https://gateway.test/api/agent/heartbeat", {
      method: "POST", headers: { Authorization: fixture.agentAuth, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "online", printers: [{ id: fixture.printerId, name: row.name, printerType: "physical", deviceClass: "thermal",
        connectionType: "spooler", protocol: "spooler", status: "online", config: row.config,
        capabilities: { operational_verification: operational(), geometry: geometry({ printer_id: "other-printer" }), supported_protocols: ["pdf", "image"] } }], desiredStateAcks: [], gatewayOwnedPrinterIds: [] }),
    }));
    expect(response.status).toBe(200);
    const published = await inventory();
    expect(published.printableWidthDots).toBeNull();
    expect(published.capabilities.supported_protocols).toEqual(["pdf"]);
    const retained = (await pool().query("SELECT capabilities FROM printers WHERE tenant_id=$1 AND id=$2", [fixture.tenantId, fixture.printerId])).rows[0].capabilities;
    expect(retained).not.toHaveProperty("geometry");
    expect(retained.geometry_error).toContain("different printer");
  });

  it("does not attach an old destination's geometry to a manager's newly configured queue", async () => {
    await pool().query("UPDATE printers SET management_source='manager',desired_revision=1,applied_desired_revision=1,observed_desired_revision=1 WHERE tenant_id=$1 AND id=$2", [fixture.tenantId, fixture.printerId]);
    const response = await heartbeat(new Request("https://gateway.test/api/agent/heartbeat", {
      method: "POST", headers: { Authorization: fixture.agentAuth, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "online", printers: [{ id: fixture.printerId, name: "Previous queue", printerType: "physical", deviceClass: "thermal",
        connectionType: "spooler", protocol: "spooler", status: "online", config: { spooler_name: "Previous destination" },
        capabilities: { operational_verification: operational(), geometry: geometry(), supported_protocols: ["pdf", "image"] } }], desiredStateAcks: [], gatewayOwnedPrinterIds: [fixture.printerId] }),
    }));
    expect(response.status).toBe(200);
    const published = await inventory();
    expect(published).toBeUndefined();
    const row = (await pool().query("SELECT config,capabilities FROM printers WHERE tenant_id=$1 AND id=$2", [fixture.tenantId, fixture.printerId])).rows[0];
    expect(row.config.spooler_name).toBe("Measured receipt queue");
    expect(row.capabilities.geometry_error).toContain("previous printer destination");
  });

  it("does not invalidate discovery approval for timestamp-only refreshes but does for geometry changes", async () => {
    async function report(id: string, value: unknown) {
      await pool().query("INSERT INTO discovery_sessions(id,tenant_id,agent_id,status,config,stats) VALUES ($1,$2,$3,'running','{}','{}')", [id, fixture.tenantId, fixture.agentId]);
      const response = await reportDiscovery(new Request("https://gateway.test/api/agent/discovery", {
        method: "POST", headers: { Authorization: fixture.agentAuth, "Content-Type": "application/json" },
        body: JSON.stringify({ discoveryId: id, status: "completed", devices: [{ id: "geometry-observation", stableId: "geometry-physical-device", source: ["ipp"], protocol: "ipp", ipAddress: "192.168.1.50", port: 631, capabilities: { geometry: value } }] }),
      }));
      expect(response.status).toBe(200);
    }
    await report("geometry-discovery-first", geometry());
    await pool().query("UPDATE discovered_devices SET candidate_status='verified',verification='verified' WHERE tenant_id=$1", [fixture.tenantId]);
    await report("geometry-discovery-refresh", geometry({ observed_at: "2026-10-24T12:02:00Z" }));
    const retained = (await pool().query("SELECT candidate_status,verification FROM discovered_devices WHERE tenant_id=$1", [fixture.tenantId])).rows[0];
    expect(retained).toEqual({ candidate_status: "verified", verification: "verified" });
    await report("geometry-discovery-changed", geometry({ config_fingerprint: "c".repeat(64), dpi_y: 300 }));
    const changed = (await pool().query("SELECT candidate_status,verification FROM discovered_devices WHERE tenant_id=$1", [fixture.tenantId])).rows[0];
    expect(changed).toEqual({ candidate_status: "discovered", verification: "candidate" });
  });
});
