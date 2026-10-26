import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { migrateByHash } from "../scripts/db-migrate";

const hasTestDatabase = Boolean(process.env.DATABASE_URL);
describe.skipIf(!hasTestDatabase)("physical-only cutover historical evidence", () => {
  let admin: Pool, target: Pool, directory: string;
  async function migrate(folder: string) {
    const client = await target.connect();
    try { await migrateByHash(client, folder); } finally { client.release(); }
  }
  beforeAll(async () => {
    const source = new URL(process.env.DATABASE_URL!); source.pathname = "/postgres";
    admin = new Pool({ connectionString: source.href, max: 1 });
    const database = `physical_history_${randomBytes(8).toString("hex")}`;
    await admin.query(`CREATE DATABASE "${database}"`);
    source.pathname = `/${database}`;
    target = new Pool({ connectionString: source.href, max: 2 });
    directory = await mkdtemp(join(tmpdir(), "yaseir-physical-history-"));
    await mkdir(join(directory, "meta"));
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    const entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 81);
    await writeFile(join(directory, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await cp(join("drizzle", `${entry.tag}.sql`), join(directory, `${entry.tag}.sql`));
    await migrate(directory);
    await target.query("INSERT INTO tenants(id,name) VALUES ('retired','Retired'),('retained','Retained')");
    await target.query("INSERT INTO agents(id,tenant_id,name) VALUES ('old-agent','retired','Old'),('live-agent','retained','Live')");
    // A physical-labelled queue is still selected by immutable0081's name rule.
    await target.query(`INSERT INTO printers(id,tenant_id,agent_id,name) VALUES
      ('old-printer','retired','old-agent','Microsoft Print to PDF'),('live-printer','retained','live-agent','Office printer')`);
    await target.query(`INSERT INTO print_jobs(id,tenant_id,agent_id,printer_id,status,payload,expires_at,error)
      VALUES ('old-job','retired','old-agent','old-printer','claimed','{"type":"raw","protocol":"raw","data_base64":"eA=="}',now()+interval '1 day','UNKNOWN: interrupted after delivery'),
      ('live-job','retained','live-agent','live-printer','failed','{"type":"raw","protocol":"raw","data_base64":"eA=="}',now()+interval '1 day','Real printer evidence')`);
    await target.query(`INSERT INTO job_events(id,tenant_id,job_id,stage,status,message,metadata)
      VALUES ('old-event','retired','old-job','delivery','error','Physical outcome UNKNOWN','{"outcome":"UNKNOWN"}'),
      ('live-event','retained','live-job','failed','error','Retain','{}')`);
    await target.query("INSERT INTO discovery_sessions(id,tenant_id,agent_id) VALUES ('old-scan','retired','old-agent'),('live-scan','retained','live-agent')");
    await target.query(`INSERT INTO discovered_devices(id,tenant_id,agent_id,discovery_id,device_name,provisioned_printer_id) VALUES
      ('old-device','retired','old-agent','old-scan','Old queue','old-printer'),
      ('unbound-virtual','retired','old-agent','old-scan','OneNote',NULL),
      ('live-device','retained','live-agent','live-scan','Office printer','live-printer')`);
    await target.query(`INSERT INTO print_job_receipts(id,tenant_id,printer_id,agent_id,fingerprint,status,error,created_at,updated_at)
      VALUES ('old-receipt','retired','old-printer','old-agent','old-fingerprint','failed','UNKNOWN: delivery ambiguous',now(),now()),
      ('live-receipt','retained','live-printer','live-agent','live-fingerprint','failed','Real printer evidence',now(),now())`);
  });
  afterAll(async () => {
    await target?.end();
    // Retain this private database until the disposable PostgreSQL container ends.
    try { await admin?.end(); }
    finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  });
  it("archives exact removed rows and UNKNOWN evidence atomically, without archiving unrelated tenants", async () => {
    const published = await readFile("drizzle/0081_physical_printers_only.sql", "utf8");
    const ledgerBefore = (await target.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
    await expect(migrate("drizzle")).rejects.toThrow(/still claimed\/printing/);
    expect((await target.query("SELECT to_regnamespace('legacy_printing') AS archive")).rows[0].archive).toBeNull();
    expect((await target.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows).toEqual(ledgerBefore);
    expect((await target.query("SELECT id FROM print_jobs ORDER BY id")).rows).toHaveLength(2);
    await target.query("UPDATE print_jobs SET status='failed' WHERE id='old-job'");
    const expected: Record<string, unknown[]> = {};
    for (const table of ["printers", "print_jobs", "job_events", "print_job_receipts", "discovered_devices"]) {
      expected[table] = (await target.query(`SELECT to_jsonb(r) AS record FROM ${table} r WHERE tenant_id='retired' ORDER BY id`)).rows;
    }
    await migrate("drizzle");
    for (const table of Object.keys(expected)) {
      expect((await target.query(`SELECT record FROM legacy_printing.${table} ORDER BY entity_id`)).rows).toEqual(expected[table]);
      expect((await target.query(`SELECT id FROM ${table} WHERE tenant_id='retired'`)).rows).toEqual([]);
      expect((await target.query(`SELECT id FROM ${table} WHERE tenant_id='retained'`)).rows).toHaveLength(1);
    }
    expect((await target.query("SELECT tenant_id,printer_id,job_id FROM legacy_printing.job_events")).rows).toEqual([
      { tenant_id: "retired", printer_id: "old-printer", job_id: "old-job" },
    ]);
    expect((await target.query("SELECT has_schema_privilege('public','legacy_printing','USAGE') AS allowed")).rows[0].allowed).toBe(false);
    expect(await readFile("drizzle/0081_physical_printers_only.sql", "utf8")).toBe(published);
    const ledger = (await target.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
    await migrate("drizzle");
    expect((await target.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows).toEqual(ledger);
    expect((await target.query("SELECT record FROM legacy_printing.print_jobs")).rows).toEqual(expected.print_jobs);
  });
});
