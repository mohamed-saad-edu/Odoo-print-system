import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("src/app/onboarding/page.tsx", "utf8");
// V4 intentionally replaces trial hydration with manual request reconciliation.
test("onboarding shares cancellation and reconciles the workspace plus recorded request", () => {
  assert.match(source, /void load\(controller\.signal\)/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
  assert.match(source, /\["\/api\/onboarding", "\/api\/subscription-requests"\]/);
  assert.match(source, /cache: "no-store", signal/);
  assert.match(source, /signal\?\.aborted \|\| generation !== loadGeneration\.current/);
  assert.match(source, /setName\(current => current \|\| nextWorkspace\.tenant\.name\)/);
  assert.match(source, /nextWorkspace\.subscription\?\.planId/);
});
test("activation requests reuse an idempotency key and never invoke checkout or trials", () => {
  assert.match(source, /requestKey\.current\?\.fingerprint !== fingerprint/);
  assert.match(source, /"Idempotency-Key": requestKey\.current\.key/);
  assert.doesNotMatch(source, /billing\/checkout|submit\(true\)|startFreeTrial|continueToCheckout/);
  assert.match(source, /workspace\?\.role !== "owner"/);
});
test("pending state offers refresh and active state reaches real device views", () => {
  assert.match(source, /document\.visibilityState === "visible"/);
  assert.match(source, /\/dashboard#agents/);
  assert.match(source, /\/dashboard#printers/);
  assert.match(source, /downloadUnavailable/);
});
