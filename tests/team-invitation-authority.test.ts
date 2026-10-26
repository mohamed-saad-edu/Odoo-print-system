import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  role: "owner", live: true, lifecycle: "active", duplicate: false, memberExists: false,
  insertions: [] as Record<string, unknown>[], proofChecks: 0, emailSends: 0, statements: [] as string[],
}));
const dialect = new PgDialect();
vi.mock("../src/lib/manager-auth", () => ({
  validateWorkspaceManager: async () => ({ userId: "regular", tenantId: "tenant", role: state.role }),
}));
vi.mock("../src/lib/platform-auth", () => ({
  requirePlatformOwner: async () => {
    if (!state.live) throw Object.assign(new Error("Unauthenticated"), { status: 401 });
    return { userId: "platform-admin", email: "admin@example.invalid" };
  },
  requirePlatformActorInTransaction: async () => { state.proofChecks += 1; },
  PlatformUnauthorizedError: class PlatformUnauthorizedError extends Error {},
  PlatformMutationAuthorityChangedError: class PlatformMutationAuthorityChangedError extends Error {},
}));
vi.mock("../src/lib/platform-team-security", () => ({ assertPlatformTeamOrigin: () => {} }));
vi.mock("../src/lib/email", () => ({
  appBaseUrl: () => "https://audit.invalid",
  sendTransactionalEmail: async () => { state.emailSends += 1; },
}));
vi.mock("../src/i18n/server", () => ({ getServerLocale: async () => "en", makeT: () => (key: string) => key }));
vi.mock("../src/lib/audit", () => ({ writeAuditEvent: async () => {} }));
vi.mock("../src/db", () => {
  const tx = {
    execute: async (statement: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const s = dialect.sqlToQuery(statement).sql;
      state.statements.push(s);
      if (s.includes("FROM tenants")) return { rows: [{ id: "tenant", lifecycle: state.lifecycle }] };
      if (s.includes("FROM tenant_users")) return { rows: state.memberExists ? [{ id: "already" }] : [] };
      return { rows: [] };
    },
    query: { tenantInvitations: { findFirst: async () => state.duplicate ? { id: "existing" } : null } },
    insert: () => ({ values: async (value: Record<string, unknown>) => { state.insertions.push(value); } }),
  };
  return { db: { transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } };
});
import { POST as oldPOST } from "../src/app/api/team/invitations/route";
import { POST as platformPOST } from "../src/app/api/platform/tenants/[id]/invitations/route";
const ctx = { params: Promise.resolve({ id: "tenant" }) };
const request = (body: object, path = "/api/team/invitations") =>
  new Request(`https://gateway.test${path}`, { method: "POST", body: JSON.stringify(body) });
const email = "invitee@example.invalid";

describe("invitation authority is reserved for the separate Platform Owner", () => {
  beforeEach(() => {
    state.role="owner";state.live=true;state.lifecycle="active";state.duplicate=false;state.memberExists=false;
    state.insertions=[];state.statements=[];state.proofChecks=0;state.emailSends=0;
  });
  it.each(["owner","admin","operator","viewer","integration_admin","billing_admin"])(
    "old workspace %s has no invitation write side effects", async role => {
      state.role = role;
      const res = await oldPOST(request({ email, role: "admin" }));
      expect(res.status).toBe(403);
      expect(state.insertions).toEqual([]);
      expect(state.emailSends).toBe(0);
      expect(state.proofChecks).toBe(0);
    });
  it("platform creates only a single canonical Full Access invitation after proof and tenant lock", async () => {
    const result = await platformPOST(request({email}, "/api/platform/tenants/tenant/invitations"),ctx);
    expect(result.status).toBe(201);
    expect(state.proofChecks).toBe(1);
    expect(state.insertions).toHaveLength(1);
    expect(state.insertions[0]).toMatchObject({role:"admin",tenantId:"tenant",email});
    expect(state.statements[0]).toContain("FOR UPDATE");
    expect(state.emailSends).toBe(1);
  });
  it("refuses any supplied role, even the former owner role", async () => {
    const result = await platformPOST(request({email,role:"owner"}, "/api/platform/tenants/tenant/invitations"),ctx);
    expect(result.status).toBe(400);
    expect(state.insertions).toEqual([]);
    expect(state.emailSends).toBe(0);
  });
  it("rejects revoked platform identity before a tenant mutation", async () => {
    state.live=false;
    await platformPOST(request({email}, "/api/platform/tenants/tenant/invitations"),ctx);
    expect(state.proofChecks).toBe(0);
    expect(state.insertions).toHaveLength(0);
  });
  it.each(["suspended", "deleted"])("cannot invite into a %s workspace", async lifecycle => {
    state.lifecycle=lifecycle;
    const res=await platformPOST(request({email}, "/api/platform/tenants/tenant/invitations"),ctx);
    expect(res.status).toBe(409);
    expect(state.insertions).toHaveLength(0);
    expect(state.emailSends).toBe(0);
  });
  it("checks duplicate active invitations and existing members before issuing tokens", async () => {
    state.duplicate=true;
    let res=await platformPOST(request({email}, "/api/platform/tenants/tenant/invitations"),ctx);
    expect(res.status).toBe(409);
    state.duplicate=false; state.memberExists=true;
    res=await platformPOST(request({email}, "/api/platform/tenants/tenant/invitations"),ctx);
    expect(res.status).toBe(409);
    expect(state.insertions).toHaveLength(0);
    expect(state.emailSends).toBe(0);
  });
});
