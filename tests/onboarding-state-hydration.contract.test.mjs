import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const ui = fs.readFileSync("src/app/onboarding/page.tsx", "utf8");
const workspace = fs.readFileSync("src/app/api/onboarding/route.ts", "utf8");
const request = fs.readFileSync("src/app/api/subscription-requests/route.ts", "utf8");
test("workspace onboarding cannot expose plans or submit commercial requests", () => {
  assert.match(ui, /redirect\("\/dashboard"\)/);
  assert.doesNotMatch(ui, /fetchWithTimeout|subscription-requests|\/api\/onboarding/);
  assert.match(workspace, /PLATFORM_OWNER_REQUIRED/);
  assert.match(request, /PLATFORM_OWNER_REQUIRED/);
});
test("platform commercial controls remain separate from a workspace session", () => {
  const platform = fs.readFileSync("src/app/api/platform/subscriptions/route.ts", "utf8");
  assert.match(platform, /requirePlatformOwner/);
  assert.doesNotMatch(platform, /validateWorkspaceManager/);
});
