import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production TypeScript safety contracts", () => {
  it("does not use escape-hatch casts or suppression directives in source", () => {
    const root = resolve(process.cwd(), "src");
    const files = [
      "app/api/printers/[id]/route.ts",
      "desktop/components/AddPrinterDialog.tsx",
      "db/schema.ts",
    ];

    for (const relative of files) {
      const source = readFileSync(resolve(root, relative), "utf8");
      expect(source).not.toMatch(/\bas\s+(?:any|never)\b/);
      expect(source).not.toMatch(/@ts-(?:ignore|expect-error)/);
    }
  });

  it("keeps printer capability metadata compatible with the API's validated record contract", () => {
    const source = readFileSync(resolve(process.cwd(), "src/db/schema.ts"), "utf8");
    expect(source).toContain('capabilities: jsonb("capabilities").$type<Record<string, unknown>>()');
  });
  it("awaits the database-backed manager token verifier on server pages", () => {
    const internalReport = readFileSync(resolve(process.cwd(), "src/app/platform/release-readiness/page.tsx"), "utf8");
    expect(internalReport).toContain("await validatePlatformClaims(verifyPlatformTokenSignature(token), true)");
    expect(internalReport).toContain('sessionCookieName("platform")');

    const billing = readFileSync(resolve(process.cwd(), "src/app/billing/page.tsx"), "utf8");
    expect(billing).toContain('redirect("/platform/subscriptions")');
    const dashboard = readFileSync(resolve(process.cwd(), "src/app/dashboard/page.tsx"), "utf8");
    expect(dashboard).toContain("verifyWorkspaceTokenFromCookieValues(");
    expect(dashboard).toContain("await verifyWorkspaceTokenFromCookieValues(");

    const publicHome = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf8");
    expect(publicHome).toContain("verifyWorkspaceTokenFromCookieValues(");
  });

  it("does not let an invalid customer cookie shadow a valid manager workspace session", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/manager-auth.ts"), "utf8");
    expect(source).toContain("const managerClaims = await verifyManagerToken(managerToken);");
    expect(source).toContain("if (managerClaims) return managerClaims;");
    expect(source).toContain("return customerToken ? verifyWorkspaceToken(customerToken) : null;");
    expect(source).not.toContain("const token = customerToken ?? managerToken;");
  });

  it("keeps database-clock printer updates compatible with Drizzle update typing", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/api/printers/[id]/route.ts"), "utf8");
    expect(source).toContain("updatedAt: SQL;");
    expect(source).toContain("updatedAt: sql`now()`");
    expect(source).not.toContain("Partial<typeof printers.$inferInsert> = { updatedAt: sql`now()` }");
  });
});
