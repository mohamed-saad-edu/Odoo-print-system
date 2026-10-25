import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
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
