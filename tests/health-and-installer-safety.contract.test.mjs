import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const health = readFileSync("src/lib/system-health.ts", "utf8");
const route = readFileSync("src/app/api/system/health/route.ts", "utf8");
const workflow = readFileSync(".github/workflows/build-windows.yml", "utf8");

test("health API never reflects raw PostgreSQL exception text to workspace users", () => {
  assert.match(route, /NextResponse\.json\(health/);
  for (const [check, message] of [
    ["Database", "Database health check unavailable"],
    ["Queue", "Queue health check unavailable"],
    ["Agents", "Agent health check unavailable"],
    ["Printers", "Printer health check unavailable"],
  ]) {
    assert.match(health, new RegExp(`name: "${check}", state: "(?:error|unknown)"[^\n]*message: "${message}"`));
  }
  assert.doesNotMatch(health, /String\(e\)\.slice\(0, 200\)/);
  assert.doesNotMatch(health, /message: `(?:DB unreachable|Queue check failed|Agent check failed|Printer check failed)/);
  assert.match(health, /reportHealthLookupError\("database", e\)/);
  assert.match(health, /errorCode: code/);
});

test("failing Windows acceptance retains a distinctly unverified diagnostic artifact", () => {
  const verified = workflow.indexOf("- name: Upload Windows NSIS installer");
  const fallback = workflow.indexOf("- name: Upload unverified Windows installer for diagnostics");
  assert.ok(verified > 0 && fallback > verified);
  assert.match(workflow.slice(fallback), /if: failure\(\)/);
  assert.match(workflow.slice(fallback), /Yaseir-Manager-Windows-NSIS-UNVERIFIED-DIAGNOSTIC/);
  assert.match(workflow.slice(fallback), /if-no-files-found: ignore/);
  assert.match(workflow.slice(verified, fallback), /if-no-files-found: error/);
});

test("release installer artifact is gated on independent publisher trust", () => {
  const verified = workflow.indexOf("- name: Upload Windows NSIS installer");
  const untrusted = workflow.indexOf("- name: Upload untrusted Windows installer for internal testing");
  const failed = workflow.indexOf("- name: Upload unverified Windows installer for diagnostics");
  assert.ok(verified > 0 && verified < untrusted && untrusted < failed);
  assert.match(workflow.slice(verified, untrusted), /if: env.YASEIR_TRUSTED_RELEASE_SIGNING == 'true'/);
  assert.match(workflow.slice(untrusted, failed), /if: success\(\) && env.YASEIR_TRUSTED_RELEASE_SIGNING != 'true'/);
  assert.match(workflow.slice(untrusted, failed), /UNTRUSTED-TEST-ONLY/);
  assert.match(workflow, /ChainPolicy\.ApplicationPolicy\.Add/);
  assert.match(workflow, /ChainPolicy\.RevocationMode/);
  assert.doesNotMatch(workflow, /gh secret set /);
});

test("Docker checks DB-backed readiness rather than process-only liveness", () => {
  const compose = readFileSync("docker-compose.yml", "utf8");
  const dockerfile = readFileSync("Dockerfile", "utf8");
  assert.match(compose, /\/api\/health'\)\.then/);
  assert.match(dockerfile, /\/api\/health \|\| exit 1/);
});
