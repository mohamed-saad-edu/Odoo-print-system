import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasManagerPermission } from "../src/lib/authorization";
const status = readFileSync("src/app/api/billing/status/route.ts", "utf8");
const shell = readFileSync("src/components/AppShell.tsx", "utf8");
const usage = readFileSync("src/app/api/billing/usage/route.ts", "utf8");

describe("workspace cannot discover commercial billing", () => {
  it("only polls service availability on shell mount, never protected quota", () => {
    expect(shell).toContain('fetchWithTimeout("/api/billing/status?includePlanName=1"');
    expect(shell).not.toContain('fetchWithTimeout("/api/billing/usage"');
    expect(status).toContain("customerSubscriptionState(");
  });
  it("does not query a plan name or return subscription commercial fields", () => {
    expect(status).not.toContain("planName");
    expect(status).not.toContain("monthlyQuota");
    expect(status).not.toContain("planId");
    expect(status).toContain("Cache-Control");
  });
  it("every former workspace role is refused usage by the existing server-side guard", () => {
    expect(usage).toContain('requireManagerPermission(manager, "billing.read")');
    for (const role of ["owner","admin","viewer","operator","billing_admin","integration_admin"]) {
      expect(hasManagerPermission({ role } as Parameters<typeof hasManagerPermission>[0], "billing.read")).toBe(false);
    }
  });
});
