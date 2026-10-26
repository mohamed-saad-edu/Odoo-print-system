import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { profileConfiguration } from "../scripts/postgres-role-profile.mjs";

const settings = () => ({ PGHOST: "127.0.0.1", PGPORT: "5432", PGDATABASE: "yaseir", PGUSER: "bootstrap",
  YASEIR_DB_PROFILE_CONFIRM: "yaseir", PGPASSWORD: randomBytes(32).toString("hex"),
  POSTGRES_OWNER_PASSWORD: randomBytes(32).toString("hex"), POSTGRES_RUNTIME_PASSWORD: randomBytes(32).toString("hex") });

test("database role profile fails closed on credential or identity ambiguity", () => {
  const base = settings();
  assert.equal(profileConfiguration(base).runtime, "yaseir_runtime");
  for (const overrides of [{ YASEIR_DB_PROFILE_CONFIRM: "wrong" }, { POSTGRES_RUNTIME_USER: "bootstrap" },
    { POSTGRES_OWNER_USER: "pg_owner" }, { POSTGRES_RUNTIME_USER: 'x; CREATE ROLE bad' }, { PGPORT: "0" },
    { POSTGRES_RUNTIME_PASSWORD: base.PGPASSWORD }, { POSTGRES_OWNER_PASSWORD: "" }, { POSTGRES_OWNER_PASSWORD: "changeme".repeat(8) }]) {
    assert.throws(() => profileConfiguration({ ...base, ...overrides }));
  }
});

test("database role secret files take precedence and failures do not reflect values", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yaseir-role-config-"));
  try {
    const base = settings(), file = path.join(directory, "runtime-secret");
    fs.writeFileSync(file, base.POSTGRES_RUNTIME_PASSWORD + "\n", { mode: 0o600 });
    assert.equal(profileConfiguration({ ...base, POSTGRES_RUNTIME_PASSWORD: "ignored", POSTGRES_RUNTIME_PASSWORD_FILE: file }).runtimePassword, base.POSTGRES_RUNTIME_PASSWORD);
    fs.writeFileSync(file, "");
    assert.throws(() => profileConfiguration({ ...base, POSTGRES_RUNTIME_PASSWORD_FILE: file }), error => !error.message.includes(base.POSTGRES_RUNTIME_PASSWORD));
    assert.throws(() => profileConfiguration({ ...base, POSTGRES_RUNTIME_PASSWORD_FILE: file + "-missing" }), /Cannot read configured POSTGRES_RUNTIME_PASSWORD file/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("provider archive remains owner-managed and invisible to runtime across deployments", () => {
  const source = fs.readFileSync(new URL("../scripts/postgres-role-profile.mjs", import.meta.url), "utf8");
  const permissions = fs.readFileSync(new URL("../scripts/audit-runtime-privileges.sql", import.meta.url), "utf8");
  const acceptance = fs.readFileSync(new URL("../scripts/acceptance/postgres-roles.mjs", import.meta.url), "utf8");
  assert.match(source, /"public", "drizzle", "information_schema", "legacy_billing"/);
  assert.match(source, /nspname IN \('public','drizzle','legacy_billing'\)/);
  assert.match(source, /archive_access/);
  assert.match(source, /archived_table_access/);
  assert.match(permissions, /REVOKE ALL ON SCHEMA legacy_billing FROM PUBLIC/);
  assert.match(permissions, /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA legacy_billing/);
  assert.match(acceptance, /runtime-legacy-archive-access-denied/);
});
