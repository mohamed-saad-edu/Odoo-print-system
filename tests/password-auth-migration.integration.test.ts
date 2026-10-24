import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrateByHash } from "../scripts/db-migrate";
import { hashPassword } from "../src/lib/password";
import { credentialVersionFor } from "../src/lib/session-credentials";
import { isPlatformSessionAssured } from "../src/lib/platform-session-security";
import { readWorkspaceSessionState } from "../src/lib/workspace-session-security";
import type { DbTx } from "../src/db";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const hasTestDatabase = Boolean(process.env.DATABASE_URL);
const factorTables = ["platform_mfa_challenges","platform_mfa_credentials","platform_mfa_grants","platform_mfa_recovery_codes",
  "workspace_mfa_challenges","workspace_mfa_credentials","workspace_mfa_grants","workspace_mfa_recovery_codes"];

describe.skipIf(!hasTestDatabase)("populated V2 to password-only migration", () => {
  let admin: Pool, target: Pool, directory: string, priorDirectory: string, database: string, passwordHash: string;
  async function apply(folder: string) {
    const client = await target.connect(); try { await migrateByHash(client, folder); } finally { client.release(); }
  }
  async function snapshot() {
    const tables = (await target.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    const rows: Record<string, unknown> = {};
    for (const { tablename } of tables) rows[tablename] = (await target.query(`SELECT to_jsonb(t) row FROM "${tablename}" t ORDER BY to_jsonb(t)::text`)).rows;
    rows.ledger = (await target.query("SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
    return rows;
  }
  beforeAll(async () => {
    process.env.GATEWAY_JWT_SECRET = randomBytes(32).toString("base64url");
    const source = new URL(process.env.DATABASE_URL!); source.pathname = "/postgres";
    admin = new Pool({ connectionString: source.href, max: 1 });
    database = `password_upgrade_${randomBytes(8).toString("hex")}`;
    await admin.query(`CREATE DATABASE "${database}"`);
    source.pathname = `/${database}`; target = new Pool({ connectionString: source.href, max: 2, options: "-c timezone=UTC" });
    directory = await mkdtemp(join(tmpdir(), "yaseir-password-upgrade-")); priorDirectory = join(directory,"v2");
    await mkdir(join(priorDirectory,"meta"),{recursive:true});
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json","utf8"));
    const priorEntries = journal.entries.filter((entry:{idx:number}) => entry.idx < 93);
    expect(priorEntries).toHaveLength(93);
    await writeFile(join(priorDirectory,"meta/_journal.json"),JSON.stringify({...journal,entries:priorEntries}));
    for (const entry of priorEntries) await cp(join("drizzle",`${entry.tag}.sql`),join(priorDirectory,`${entry.tag}.sql`));
    await apply(priorDirectory);
    passwordHash = await hashPassword(randomBytes(24).toString("base64url"));
    const proof = credentialVersionFor("owner",passwordHash);
    await target.query("INSERT INTO tenants(id,name) VALUES('upgrade-tenant','Preserved workspace')");
    await target.query("INSERT INTO users(id,email,password_hash,email_verified_at,is_platform_owner,platform_mfa_version,workspace_mfa_version) VALUES('owner','owner@upgrade.invalid',$1,now(),true,7,9),('unverified','unverified@upgrade.invalid',$1,NULL,false,0,0)",[passwordHash]);
    await target.query("INSERT INTO tenant_users(user_id,tenant_id,role) VALUES('owner','upgrade-tenant','owner'),('unverified','upgrade-tenant','viewer')");
    await target.query("INSERT INTO platform_sessions(jti,user_id,expires_at,revoked_at) VALUES('legacy-owner-session','owner',now()+interval '1 hour',now()-interval '1 minute')");
    await target.query("INSERT INTO manager_sessions(jti,tenant_id,user_id,role,expires_at,revoked_at) VALUES('legacy-workspace-session','upgrade-tenant','owner','owner',now()+interval '1 hour',now()-interval '1 minute')");
    for (const kind of ["platform","customer","manager"]) {
      const family = `${kind}-family`, sid = `${kind}-sid`, tenant = kind === "platform" ? null : "upgrade-tenant";
      await target.query("INSERT INTO refresh_tokens(id,family_id,kind,tenant_id,user_id,role,email,token_hash,issued_at,family_created_at,expires_at) VALUES($1,$2,$3,$4,'owner',$5,'owner@upgrade.invalid',$6,now()-interval '1 minute',now()-interval '10 minutes',now()+interval '1 hour')",[sid,family,kind,tenant,kind === "platform" ? null : "owner",digest(randomBytes(32).toString("hex"))]);
      await target.query("INSERT INTO refresh_tokens(id,family_id,kind,tenant_id,user_id,role,email,token_hash,issued_at,family_created_at,expires_at,revoked_at,revoked_reason,replaced_by,replaced_at) VALUES($1,$2,$3,$4,'owner',$5,'owner@upgrade.invalid',$6,now()-interval '9 minutes',now()-interval '10 minutes',now()+interval '1 hour',now()-interval '1 minute','rotated',$7,now()-interval '1 minute')",[`${kind}-prior-sid`,family,kind,tenant,kind === "platform" ? null : "owner",digest(randomBytes(32).toString("hex")),sid]);
      if (kind === "platform") await target.query("INSERT INTO platform_session_security(family_id,user_id,mfa_version,method,verified_at,password_verified_at,last_seen_at,expires_at) VALUES($1,'owner',7,'totp',now()-interval '2 minutes',now()-interval '2 minutes',now()-interval '1 minute',now()+interval '1 hour')",[family]);
      else await target.query("INSERT INTO workspace_session_security(family_id,kind,tenant_id,user_id,credential_version,created_at,password_verified_at,last_seen_at,expires_at,mfa_version,mfa_method,mfa_verified_at) VALUES($1,$2,'upgrade-tenant','owner',$3,now()-interval '10 minutes',now()-interval '2 minutes',now()-interval '1 minute',now()+interval '1 hour',9,'totp',now()-interval '2 minutes')",[family,kind,proof]);
    }
    await target.query("INSERT INTO platform_session_security(family_id,user_id,mfa_version,method,verified_at,password_verified_at,last_seen_at,expires_at,revoked_at) VALUES('revoked-family','owner',7,'totp',now()-interval '10 minutes',now()-interval '10 minutes',now()-interval '8 minutes',now()+interval '1 hour',now()-interval '5 minutes')");
    for (const realm of ["platform","workspace"]) {
      // Historical-only fixture material exercises deletion of populated stores.
      // These inert bytes are never accepted by an authentication implementation.
      await target.query(`INSERT INTO ${realm}_mfa_credentials(id,user_id,kind,name,encrypted_secret,counter) VALUES($1,'owner','totp','Retired synthetic encrypted fixture','inert-ciphertext',1234)`,[`${realm}-factor`]);
      await target.query(`INSERT INTO ${realm}_mfa_recovery_codes(code_hash,user_id,used_at) VALUES($1,'owner',NULL),($2,'owner',now()-interval '1 hour')`,[digest(`${realm}-unused`),digest(`${realm}-used`)]);
      if (realm === "platform") {
        await target.query("INSERT INTO platform_mfa_challenges(id,user_id,credential_version,mfa_version,purpose,origin,attempts,expires_at) VALUES('pending-platform','owner',$1,7,'login','https://upgrade.invalid',3,now()+interval '2 minutes')",[proof]);
        await target.query("INSERT INTO platform_mfa_grants(token_hash,user_id,credential_version,mfa_version,method,password_verified_at,expires_at) VALUES($1,'owner',$2,7,'totp',now()-interval '2 minutes',now()+interval '1 minute')",[digest("platform-grant"),proof]);
      } else {
        await target.query("INSERT INTO workspace_mfa_challenges(id,user_id,kind,tenant_id,role,credential_version,mfa_version,purpose,origin,attempts,expires_at) VALUES('pending-workspace','owner','customer','upgrade-tenant','owner',$1,9,'login','https://upgrade.invalid',3,now()+interval '2 minutes')",[proof]);
        await target.query("INSERT INTO workspace_mfa_grants(token_hash,user_id,kind,tenant_id,role,credential_version,mfa_version,origin,method,password_verified_at,expires_at) VALUES($1,'owner','customer','upgrade-tenant','owner',$2,9,'https://upgrade.invalid','totp',now()-interval '2 minutes',now()+interval '1 minute')",[digest("workspace-grant"),proof]);
      }
    }
  });
  afterAll(async () => {
    await target?.end();
    try { if (database) await admin.query(`DROP DATABASE "${database}"`); }
    finally { await admin?.end(); if (directory) await rm(directory,{recursive:true,force:true}); }
  });

  it("refuses unexpected dependencies and rolls the entire migration back without deleting authority", async () => {
    await target.query("CREATE VIEW public.custom_retired_factor_export AS SELECT id,public_key FROM platform_mfa_credentials");
    const before = await snapshot();
    await expect(apply(join(process.cwd(),"drizzle"))).rejects.toThrow(/depend/i);
    expect(await snapshot()).toEqual(before);
    expect((await target.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='platform_session_security' AND column_name='password_version'")).rows).toEqual([]);
    await target.query("DROP VIEW public.custom_retired_factor_export");
  });

  it("preserves every non-factor record and deadline, then admits retained password-bound session policies", async () => {
    const before = await snapshot();
    for (const table of factorTables) expect((before[table] as unknown[]).length).toBeGreaterThan(0);
    await apply(join(process.cwd(),"drizzle"));
    const after = await snapshot();
    const retiredColumns: Record<string,string[]> = { users:["platform_mfa_version","workspace_mfa_version"],
      platform_session_security:["mfa_version","method","verified_at"], workspace_session_security:["mfa_version","mfa_method","mfa_verified_at"] };
    for (const [table,rows] of Object.entries(before)) {
      if (table === "ledger" || factorTables.includes(table)) continue;
      const expected = (rows as Array<{row:Record<string,unknown>}>).map(({row}) => {
        const kept = {...row}; for (const column of retiredColumns[table] ?? []) delete kept[column];
        if (table === "platform_session_security") kept.password_version = digest(passwordHash);
        // V4 adds an optional display name; historical identity is not guessed.
        if (table === "users") kept.display_name = null;
        return {row:kept};
      });
      expect(after[table],`Preserve ${table} records, revocation and timestamps`).toEqual(expected);
    }
    expect(after.ledger).toEqual(expect.arrayContaining(before.ledger as unknown[]));
    // The V4 chain includes password-only0093, operational-verification0094
    // and manual-subscriptions0095; historical migration hashes stay immutable.
    expect((after.ledger as unknown[]).length).toBe((before.ledger as unknown[]).length+3);
    const priorHashes = new Set((before.ledger as Array<{hash:string}>).map(row=>row.hash));
    const addedHashes = (after.ledger as Array<{hash:string}>).filter(row=>!priorHashes.has(row.hash)).map(row=>row.hash).sort();
    const expectedHashes = await Promise.all(["0093_password_only_authentication.sql", "0094_printer_operational_verification.sql", "0095_manual_subscriptions.sql"]
      .map(async name=>digest(await readFile(join("drizzle",name),"utf8"))));
    expect(addedHashes).toEqual(expectedHashes.sort());
    expect((await target.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1::text[])",[factorTables])).rows).toEqual([]);
    const connection = drizzle(target) as unknown as DbTx;
    expect(await isPlatformSessionAssured("platform-family","owner",false,connection)).toBe(true);
    expect(await isPlatformSessionAssured("revoked-family","owner",false,connection)).toBe(false);
    for (const kind of ["customer","manager"] as const) expect(await readWorkspaceSessionState({ familyId:`${kind}-family`,kind,tenantId:"upgrade-tenant",userId:"owner",sid:`${kind}-sid`,role:"owner" },connection)).not.toBeNull();
    const baseline = await snapshot(); await apply(join(process.cwd(),"drizzle")); expect(await snapshot()).toEqual(baseline);
    expect((await readdir("drizzle")).filter(n=>n.endsWith(".sql"))).toHaveLength(96);
  });
});
