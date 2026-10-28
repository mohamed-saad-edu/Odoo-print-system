import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { users } from "../src/db/schema";
import { GET as tenantsGET } from "../src/app/api/platform/tenants/route";
import { GET as jobsGET } from "../src/app/api/platform/jobs/route";
import { createVerifiedPlatformSession } from "./helpers/platform-session";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll } from "./helpers/pg";

const suite = describe.skipIf(!hasTestDatabase);

suite("Platform directory and operations reads hold current owner authority", () => {
  const ownerId = "platform-live-directory-owner";
  const email = "directory-owner@example.test";
  let token: string;

  beforeAll(async () => {
    process.env.GATEWAY_JWT_SECRET = "platform-live-directory-owner-test-secret-32";
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    await seedFixture();
    await db.insert(users).values({
      id: ownerId, email, passwordHash: "verified-test-password-hash",
      emailVerifiedAt: new Date(), isPlatformOwner: true,
    });
    token = (await createVerifiedPlatformSession(ownerId, email)).token;
  });
  afterAll(closePool);

  const read = (kind: "tenants" | "jobs") => {
    const path = kind === "tenants" ? "tenants?limit=1" : "jobs?limit=1";
    const request = new Request("http://localhost/api/platform/" + path, {
      headers: { Authorization: "Bearer " + token },
    });
    return kind === "tenants" ? tenantsGET(request) : jobsGET(request);
  };

  it.each(["tenants", "jobs"] as const)("returns %s only to a live verified Platform Owner", async kind => {
    const response = await read(kind);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toHaveProperty(kind);
  });

  it.each(["tenants", "jobs"] as const)(
    "denies %s after revocation commits while the confidential read waits for the owner row",
    async kind => {
      const blocker = await pool().connect();
      let committed = false;
      let pending: Promise<Response> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query("UPDATE users SET is_platform_owner=false WHERE id=$1", [ownerId]);
        const pid = Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
        pending = read(kind);
        void pending.catch(() => undefined);
        await expect.poll(async () => {
          const result = await pool().query(
            "SELECT count(*)::int AS n FROM pg_stat_activity " +
            "WHERE datname=current_database() AND wait_event_type='Lock' " +
            "AND query LIKE '%FROM users%' AND query LIKE '%FOR SHARE%' " +
            "AND $1=ANY(pg_blocking_pids(pid))", [pid],
          );
          return Number(result.rows[0]?.n ?? 0);
        }, { timeout: 8_000, interval: 100 }).toBeGreaterThan(0);
        await blocker.query("COMMIT");
        committed = true;
        const response = await pending;
        expect(response.status).toBe(401);
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        expect(await response.json()).not.toHaveProperty(kind);
      } finally {
        if (!committed) await blocker.query("ROLLBACK");
        blocker.release();
        await pending?.catch(() => undefined);
      }
    },
  );
});
