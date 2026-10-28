import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { users } from "../src/db/schema";
import { createVerifiedPlatformSession } from "./helpers/platform-session";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll } from "./helpers/pg";
import { GET as subscriptionsGET } from "../src/app/api/platform/subscriptions/route";
import { GET as requestsGET } from "../src/app/api/platform/subscription-requests/route";

const suite = describe.skipIf(!hasTestDatabase);

suite("Platform commercial GET live-session transaction fences", () => {
  const ownerId = "platform-owner-commercial-read";
  const email = "commercial-read-owner@example.test";
  let token: string;

  beforeAll(async () => {
    process.env.GATEWAY_JWT_SECRET = "commercial-read-transaction-fence-test-secret-32";
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

  const read = (kind: "subscriptions" | "requests") =>
    (kind === "subscriptions" ? subscriptionsGET : requestsGET)(
      new Request("http://localhost/api/platform/" +
        (kind === "subscriptions" ? "subscriptions?limit=1" : "subscription-requests"),
      { headers: { Authorization: "Bearer " + token } }),
    );

  it.each(["subscriptions", "requests"] as const)("returns %s only to a live verified Platform Owner", async kind => {
    const response = await read(kind);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const payload = await response.json();
    expect(payload).toHaveProperty(kind === "subscriptions" ? "subscriptions" : "requests");
  });

  it.each(["subscriptions", "requests"] as const)(
    "denies %s if owner removal commits while the confidential-read lock is waiting",
    async kind => {
      const gate = await pool().connect();
      let committed = false;
      let pending: Promise<Response> | undefined;
      try {
        await gate.query("BEGIN");
        await gate.query("UPDATE users SET is_platform_owner = false WHERE id = $1", [ownerId]);
        const blockerPid = Number((await gate.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
        pending = read(kind);
        void pending.catch(() => undefined);
        await expect.poll(async () => {
          const waiting = await pool().query(
            "SELECT count(*)::int AS n FROM pg_stat_activity " +
            "WHERE datname = current_database() AND wait_event_type = 'Lock' " +
            "AND query LIKE '%JOIN platform_session_security s%' " +
            "AND $1 = ANY(pg_blocking_pids(pid))",
            [blockerPid],
          );
          return Number(waiting.rows[0]?.n ?? 0);
        }, { timeout: 8_000, interval: 100 }).toBeGreaterThan(0);
        await gate.query("COMMIT");
        committed = true;
        const response = await pending;
        expect(response.status).toBe(401);
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        expect(await response.json()).not.toHaveProperty(kind === "subscriptions" ? "subscriptions" : "requests");
      } finally {
        if (!committed) await gate.query("ROLLBACK");
        gate.release();
        await pending?.catch(() => undefined);
      }
    },
  );
});
