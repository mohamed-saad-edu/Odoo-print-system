import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { updateGitDeltaHash } from "../scripts/acceptance/gateway-soak-source.mjs";

test("provenance hashes all of a source delta larger than1MiB without a commit", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "yaseir-source-delta-test-"));
  try {
    execFileSync("git", ["init", "--quiet", fixture]);
    fs.writeFileSync(path.join(fixture, "large-source.txt"), "Synthetic source line0123456789abcdef\n".repeat(60000));
    execFileSync("git", ["add", "large-source.txt"], { cwd: fixture });
    const args = ["diff", "--cached", "--binary"];
    const reference = execFileSync("git", args, { cwd: fixture, maxBuffer: 4 * 1024 * 1024 });
    assert(reference.length > 1024 * 1024);
    assert.throws(() => execFileSync("git", args, { cwd: fixture }), /ENOBUFS/);
    const digest = createHash("sha256");
    await updateGitDeltaHash(fixture, digest, args);
    assert.equal(digest.digest("hex"), createHash("sha256").update(reference).digest("hex"));
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test("soak startup reads UTC-naive PostgreSQL evidence in UTC on a non-UTC host", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "yaseir-soak-timezone-test-"));
  const root = fileURLToPath(new URL("../", import.meta.url));
  const harness = new URL("../scripts/acceptance/gateway-soak.mjs", import.meta.url).href;
  try {
    const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
      import assert from "node:assert/strict";
      import { createRequire } from "node:module";
      import path from "node:path";
      const require = createRequire(path.join(process.cwd(), "package.json"));
      const { types } = require("pg");
      const parse = types.getTypeParser(1114, "text");
      const timestamp = "2026-10-25 03:12:16.870";
      assert.equal(process.env.TZ, "America/Bogota");
      assert.equal(parse(timestamp).toISOString(), "2026-10-25T08:12:16.870Z");
      process.argv[2] = path.join(process.env.YASEIR_TIMEZONE_TEST_ROOT, "evidence");
      let stopped;
      try { await import(${JSON.stringify(harness)}); }
      catch (error) { stopped = error; }
      assert.equal(stopped?.code, "ERR_INVALID_URL", "Stop at URL validation before creating any database pool");
      assert.equal(parse(timestamp).toISOString(), "2026-10-25T03:12:16.870Z", "Actual soak startup must preserve UTC-naive evidence timestamps");
      console.log("UTC evidence parser verified before any database connection");
    `], {
      cwd: root, timeout: 20_000, maxBuffer: 64 * 1024,
      env: { ...process.env, TZ: "America/Bogota", DATABASE_URL: "synthetic-invalid-url",
        TMPDIR: fixture, TMP: fixture, TEMP: fixture, YASEIR_TIMEZONE_TEST_ROOT: fixture },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.match(output.toString(), /UTC evidence parser verified before any database connection/);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});
