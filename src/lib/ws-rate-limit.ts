import { db } from "../db";
import { sql } from "drizzle-orm";
import { parseDbTimeMs } from "./database-clock";

const WINDOW_MS = 60_000;
const MAX_FAILURES = 20;
const LOCK_MS = 60_000;

// Upgrade admission is persisted in PostgreSQL. Do not retain an unused
// process-local map keyed by client IP; an attacker can produce unbounded keys.

export async function recordWsUpgradeSuccess(key: string): Promise<void> {
  // WP3 (STATIC REVIEW ONLY, B5-02 fix): refund exactly ONE reservation,
  // never clear the shared per-IP bucket. The previous DELETE let one
  // legitimate agent reconnect wipe another agent's accumulated failures
  // behind the same NAT/egress IP, granting a fresh 20 attempts per
  // reconnect. Refunding one keeps this attempt budget-neutral (the
  // reservation incremented failures by one) while preserving everyone
  // else's failures. A lock created by the 20th failure is released by a
  // valid success (post-refund failures < 20), but the next failure
  // re-locks immediately, so one success buys an attacker exactly one
  // attempt, not a fresh budget. The residual shared-IP failure
  // accumulation (one NAT IP can still lock others out for up to 60s) is
  // inherent to IP-keyed brute-force defence: failures cannot be keyed by
  // agent before authentication, and keying by presented credential would
  // let an attacker evade by rotating tokens and would allow unbounded
  // keys. See REPORT.md (WP3 item (b)) for the full trade-off.
  await db.execute(sql`
    UPDATE auth_rate_limits
    SET failures = GREATEST(failures - 1, 0),
        locked_until = CASE WHEN failures - 1 < ${MAX_FAILURES} THEN NULL ELSE locked_until END,
        updated_at = clock_timestamp()
    WHERE key = ${`ws-upgrade:${key}`}
  `);
}

export async function reserveWsUpgradeAttempt(key: string): Promise<{ allowed: true; retryAfterSec?: number } | { allowed: false; retryAfterSec: number }> {
  return db.transaction(async (tx) => {
    const bucketKey = `ws-upgrade:${key}`;
    await tx.execute(sql`
      INSERT INTO auth_rate_limits (key, failures, window_started_at, locked_until, updated_at)
      VALUES (${bucketKey}, 0, clock_timestamp(), NULL, clock_timestamp())
      ON CONFLICT (key) DO NOTHING
    `);
    const result = await tx.execute(sql`
      SELECT failures, window_started_at, locked_until
      FROM auth_rate_limits
      WHERE key = ${bucketKey}
      FOR UPDATE
    `);
    const clock = await tx.execute(sql`SELECT EXTRACT(EPOCH FROM clock_timestamp()) * 1000 AS now_ms`);
    const nowMs = Number(clock.rows[0]?.now_ms);
    if (!Number.isFinite(nowMs)) throw new Error("Database clock is unavailable");
    const now = new Date(nowMs);
    const cutoff = new Date(now.getTime() - WINDOW_MS);
    const row = result.rows[0] as {
      failures?: number | string;
      window_started_at?: Date | string;
      locked_until?: Date | string | null;
    } | undefined;
    // v3: previously fail-open (allowed without counting) when the bucket
    // row was missing after the insert (reachable only in races/errors).
    // Fail closed with a short retry instead; the normal path is unchanged.
    if (!row) return { allowed: false, retryAfterSec: 5 } as const;

    const existingLock = parseDbTimeMs(row.locked_until) ?? 0;
    if (existingLock > now.getTime()) {
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((existingLock - now.getTime()) / 1000)) } as const;
    }

    const windowStartMs = parseDbTimeMs(row.window_started_at ?? now) ?? now.getTime();
    const windowExpired = windowStartMs < cutoff.getTime();
    const failures = windowExpired ? 1 : Number(row.failures ?? 0) + 1;
    const windowStart = windowExpired ? now : new Date(windowStartMs);
    const lockedUntil = failures >= MAX_FAILURES ? new Date(now.getTime() + LOCK_MS) : null;

    await tx.execute(sql`
      UPDATE auth_rate_limits
      SET failures = ${failures},
          window_started_at = ${windowStart},
          locked_until = ${lockedUntil},
          updated_at = ${now}
      WHERE key = ${bucketKey}
    `);

    if (!lockedUntil) return { allowed: true } as const;
    const retryAfterSec = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));
    // The reservation itself is allowed; a failed authentication on this
    // attempt should return 429 and the next attempt is already blocked.
    return { allowed: true, retryAfterSec } as const;
  });
}
