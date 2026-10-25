import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type * as TenantGuardModule from "../src/lib/tenant-guard";
import type * as LogModule from "../src/lib/log";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn(), update: vi.fn(), desiredPage: vi.fn(), verificationClock: vi.fn(), logError: vi.fn() }));
vi.mock("../src/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("../src/lib/agent-auth", () => ({ validateAgent: async () => ({ id: "agent-a", tenantId: "tenant-a", lifecycle: "active" }) }));
vi.mock("../src/lib/tenant-guard", async (importOriginal) => ({
  ...await importOriginal<typeof TenantGuardModule>(),
  requireActiveTenantInTransaction: async () => {},
}));
vi.mock("../src/lib/desired-state-page", () => ({ getDesiredPrinterPage: mocks.desiredPage }));
vi.mock("../src/lib/log", async (importOriginal) => ({
  ...await importOriginal<typeof LogModule>(), logError: mocks.logError,
}));
import { POST } from "../src/app/api/agent/heartbeat/route";

describe("heartbeat desired-state paging negotiation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const update = { set: vi.fn(), where: vi.fn() };
    update.set.mockReturnValue(update);
    update.where.mockResolvedValue([]);
    mocks.update.mockReturnValue(update);
    mocks.transaction.mockImplementation(async callback => callback({ execute: mocks.execute, update: mocks.update }));
    mocks.verificationClock.mockResolvedValue({ rows: [{ verification_now: new Date().toISOString() }] });
    const dialect = new PgDialect();
    mocks.execute.mockImplementation(async (statement: SQL) => {
      const text = dialect.sqlToQuery(statement).sql;
      if (text.includes("SELECT pg_advisory_xact_lock(")) return { rows: [] };
      if (/\bFROM agents\b/.test(text)) return { rows: [{ id: "agent-a", lifecycle: "active", inventory_snapshot_version: "0" }] };
      if (text === "SELECT clock_timestamp() AS verification_now") return mocks.verificationClock();
      throw new Error(`Unexpected SQL in desired-state fixture: ${text}`);
    });
    mocks.desiredPage.mockResolvedValue({ items: [], nextCursor: null });
  });

  function heartbeat(desiredStatePaging?: unknown) {
    return POST(new Request("http://gateway.test/api/agent/heartbeat", { method: "POST", body: JSON.stringify({ printers: [], desiredStatePaging }) }));
  }

  it("never supplies a truncated authoritative array to an older Agent", async () => {
    mocks.desiredPage.mockResolvedValue({ items: [{ id: "first" }], nextCursor: "Zmlyc3Q" });
    const response = await heartbeat();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.desiredStateUpgradeRequired).toBe(true);
    expect(body).not.toHaveProperty("desiredState");
    expect(mocks.verificationClock).toHaveBeenCalledOnce();
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("preserves the complete small-snapshot legacy response", async () => {
    const response = await heartbeat();
    expect(await response.json()).toMatchObject({ success: true, desiredState: [] });
  });

  it("publishes continuation only when the Agent opts into paging", async () => {
    mocks.desiredPage.mockResolvedValue({ items: [{ id: "first", config: {}, desiredRevision: 1 }], nextCursor: "Zmlyc3Q" });
    const response = await heartbeat(true);
    expect(await response.json()).toMatchObject({ success: true, desiredState: [{ id: "first" }], desiredStateNextCursor: "Zmlyc3Q" });
    expect(mocks.desiredPage).toHaveBeenCalledWith("tenant-a", "agent-a", undefined, expect.any(Function));
  });

  it("rejects an invalid negotiation flag before transaction writes", async () => {
    expect((await heartbeat("true")).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("fails closed before desired-state publication when the verification clock is unavailable", async () => {
    mocks.verificationClock.mockResolvedValue({ rows: [] });
    const response = await heartbeat(true);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
    expect(mocks.desiredPage).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith("agent.heartbeat.failed", {
      agentId: "agent-a", error: "Database verification clock unavailable",
    });
  });
});
