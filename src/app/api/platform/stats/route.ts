import { NextResponse } from "next/server";
import { requirePlatformOwner, PlatformUnauthorizedError } from "../../../../lib/platform-auth";
import { db } from "../../../../db";
import { queryWithTimeout } from "../../../../db/client";
import { tenants, tenantSubscriptions, users, agents, printers, printJobs, apiKeys, odooInstallations } from "../../../../db/schema";
import { sql, eq, and, inArray } from "drizzle-orm";
import { agentStaleThresholdSeconds, printerStaleThresholdSeconds } from "../../../../lib/agent-availability";
import { nonVirtualPrinterPredicate } from "../../../../lib/printer-virtual-sql";

import { getCachedPlatformStats, setCachedPlatformStats } from "../../../../lib/platform-stats-cache";

type PlatformHourlyJobStatsRow = {
  bucket: Date | string;
  total: number | string | null;
  success: number | string | null;
  failed: number | string | null;
  queued: number | string | null;
  inFlight: number | string | null;
  expired: number | string | null;
};

export async function GET(req: Request) {
  try {
    await requirePlatformOwner(req);
  } catch (error) {
    if (error instanceof PlatformUnauthorizedError) {
      return NextResponse.json({ error: "Platform Owner authentication required" }, { status: 401 });
    }
    return NextResponse.json({ error: "Platform authentication temporarily unavailable" }, { status: 503 });
  }

  const bypassCache = req.headers.get("x-cache-bypass") === "1" || req.headers.get("cache-control") === "no-cache";
  const cached = getCachedPlatformStats(bypassCache);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "X-Cache": "HIT", "Cache-Control": "private, no-store" },
    });
  }

  const [
    tenantStats,
    subscriptionStats,
    userStats,
    agentStats,
    printerStats,
    hourlyJobStats,
    liveQueueStats,
    credentialStats,
    installationStats,
  ] = await queryWithTimeout(
    () => Promise.all([
      db.select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${tenants.lifecycle} = 'active')::int`,
        suspended: sql<number>`count(*) filter (where ${tenants.lifecycle} = 'suspended')::int`,
        deleted: sql<number>`count(*) filter (where ${tenants.lifecycle} = 'deleted')::int`,
      }).from(tenants),

      db.select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${tenantSubscriptions.status} = 'active')::int`,
        trialing: sql<number>`count(*) filter (where ${tenantSubscriptions.status} = 'trialing')::int`,
        pastDue: sql<number>`count(*) filter (where ${tenantSubscriptions.status} = 'past_due')::int`,
        incomplete: sql<number>`count(*) filter (where ${tenantSubscriptions.status} = 'incomplete')::int`,
        incompleteExpired: sql<number>`count(*) filter (where ${tenantSubscriptions.status} = 'incomplete_expired')::int`,
        unpaid: sql<number>`count(*) filter (where ${tenantSubscriptions.status} = 'unpaid')::int`,
        paused: sql<number>`count(*) filter (where ${tenantSubscriptions.status} = 'paused')::int`,
        cancelled: sql<number>`count(*) filter (where ${tenantSubscriptions.status} = 'cancelled')::int`,
        attention: sql<number>`count(*) filter (where ${tenantSubscriptions.status} in ('past_due','incomplete','incomplete_expired','unpaid'))::int`,
      }).from(tenantSubscriptions),

      db.select({
        total: sql<number>`count(*)::int`,
        verified: sql<number>`count(*) filter (where ${users.emailVerifiedAt} is not null)::int`,
      }).from(users),

      db.select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${agents.lifecycle} = 'active')::int`,
        online: sql<number>`count(*) filter (
          where ${agents.lifecycle} = 'active'
            and ${agents.status} = 'online'
            and ${agents.lastSeenAt} is not null
            and ${agents.lastSeenAt} <= now()
            and ${agents.lastSeenAt} >= now() - make_interval(secs => ${agentStaleThresholdSeconds()})
        )::int`,
        offline: sql<number>`count(*) filter (
          where ${agents.lifecycle} = 'active'
            and ${agents.status} = 'offline'
            and ${agents.lastSeenAt} is not null
            and ${agents.lastSeenAt} <= now()
            and ${agents.lastSeenAt} >= now() - make_interval(secs => ${agentStaleThresholdSeconds()})
        )::int`,
        unknown: sql<number>`count(*) filter (
          where ${agents.lifecycle} = 'active'
            and (
              ${agents.lastSeenAt} is null
              or ${agents.lastSeenAt} > now()
              or ${agents.lastSeenAt} < now() - make_interval(secs => ${agentStaleThresholdSeconds()})
              or ${agents.status} not in ('online','offline')
            )
        )::int`,
        inactive: sql<number>`count(*) filter (where ${agents.lifecycle} <> 'active')::int`,
      }).from(agents),

      db.select({
        total: sql<number>`count(*) filter (where ${printers.inventoryPresent} = true)::int`,
        active: sql<number>`count(*) filter (
          where ${printers.inventoryPresent} = true and ${printers.lifecycle} = 'active'
        )::int`,
        online: sql<number>`count(*) filter (
          where ${printers.inventoryPresent} = true
            and ${printers.lifecycle} = 'active'
            and ${printers.status} = 'online'
            and ${printers.lastSeenAt} is not null
            and ${printers.lastSeenAt} <= now()
            and ${printers.lastSeenAt} >= now() - make_interval(secs => ${printerStaleThresholdSeconds()})
        )::int`,
        busy: sql<number>`count(*) filter (
          where ${printers.inventoryPresent} = true
            and ${printers.lifecycle} = 'active'
            and ${printers.status} = 'busy'
            and ${printers.lastSeenAt} is not null
            and ${printers.lastSeenAt} <= now()
            and ${printers.lastSeenAt} >= now() - make_interval(secs => ${printerStaleThresholdSeconds()})
        )::int`,
        offline: sql<number>`count(*) filter (
          where ${printers.inventoryPresent} = true
            and ${printers.lifecycle} = 'active'
            and ${printers.status} = 'offline'
            and ${printers.lastSeenAt} is not null
            and ${printers.lastSeenAt} <= now()
            and ${printers.lastSeenAt} >= now() - make_interval(secs => ${printerStaleThresholdSeconds()})
        )::int`,
        error: sql<number>`count(*) filter (
          where ${printers.inventoryPresent} = true
            and ${printers.lifecycle} = 'active'
            and ${printers.status} = 'error'
            and ${printers.lastSeenAt} is not null
            and ${printers.lastSeenAt} <= now()
            and ${printers.lastSeenAt} >= now() - make_interval(secs => ${printerStaleThresholdSeconds()})
        )::int`,
        unknown: sql<number>`count(*) filter (
          where ${printers.inventoryPresent} = true
            and ${printers.lifecycle} = 'active'
            and (
              ${printers.lastSeenAt} is null
              or ${printers.lastSeenAt} > now()
              or ${printers.lastSeenAt} < now() - make_interval(secs => ${printerStaleThresholdSeconds()})
              or ${printers.status} not in ('online','busy','offline','error')
            )
        )::int`,
        inactive: sql<number>`count(*) filter (
          where ${printers.inventoryPresent} = true and ${printers.lifecycle} <> 'active'
        )::int`,
      })
        .from(printers)
        // Retain the tenant-scoped ownership join as a security/consistency
        // tripwire, but do not turn Agent reachability into physical status.
        .leftJoin(agents, and(eq(printers.agentId, agents.id), eq(printers.tenantId, agents.tenantId)))
        .where(and(eq(printers.sharedWithGateway, true), nonVirtualPrinterPredicate())),

      db.execute(sql<PlatformHourlyJobStatsRow>`
        WITH observation AS (SELECT clock_timestamp() AS at),
        hours AS (
          SELECT generate_series(
            date_trunc('hour', (SELECT at FROM observation) - interval '24 hours'),
            date_trunc('hour', (SELECT at FROM observation)),
            interval '1 hour'
          ) AS bucket
        ),
        -- Retention moves terminal jobs to this durable payload-free table.
        -- Count accepted submissions once across both sources, by created_at.
        history AS (
          SELECT j.id, j.created_at, j.status
          FROM print_jobs j
          WHERE j.created_at >= (SELECT at FROM observation) - interval '24 hours'
          UNION ALL
          SELECT r.id, r.created_at, r.status
          FROM print_job_receipts r
          WHERE r.created_at >= (SELECT at FROM observation) - interval '24 hours'
            AND NOT EXISTS (SELECT 1 FROM print_jobs live WHERE live.id = r.id)
        )
        SELECT
          hours.bucket AS bucket,
          count(j.id)::int AS total,
          count(j.id) FILTER (WHERE j.status = 'success')::int AS success,
          count(j.id) FILTER (WHERE j.status = 'failed')::int AS failed,
          count(j.id) FILTER (WHERE j.status = 'queued')::int AS queued,
          count(j.id) FILTER (WHERE j.status IN ('claimed','printing'))::int AS "inFlight",
          count(j.id) FILTER (WHERE j.status = 'expired')::int AS expired
        FROM hours
        LEFT JOIN history j
          ON j.created_at >= hours.bucket
         AND j.created_at < hours.bucket + interval '1 hour'
        GROUP BY hours.bucket
        ORDER BY hours.bucket
      `),
      // Current backlog is independent of the historical 24-hour chart.
      // In particular, old queued or claimed jobs still count as open.
      db.select({
        queued: sql<number>`count(*) FILTER (WHERE ${printJobs.status} = 'queued')::int`,
        inFlight: sql<number>`count(*) FILTER (WHERE ${printJobs.status} IN ('claimed','printing'))::int`,
      }).from(printJobs).where(inArray(printJobs.status, ["queued", "claimed", "printing"])),
      db.select({
        total: sql<number>`count(*)::int`,
        // A rotated key can remain valid for read-only receipt lookup during
        // a grace window. It is NOT fully revoked until that window ends.
        active: sql<number>`count(*) filter (where ${apiKeys.revokedAt} is null or ${apiKeys.readOnlyUntil} > clock_timestamp())::int`,
        grace: sql<number>`count(*) filter (where ${apiKeys.revokedAt} is not null and ${apiKeys.readOnlyUntil} > clock_timestamp())::int`,
        revoked: sql<number>`count(*) filter (where ${apiKeys.revokedAt} is not null and (${apiKeys.readOnlyUntil} is null or ${apiKeys.readOnlyUntil} <= clock_timestamp()))::int`,
      }).from(apiKeys),
      db.select({
        total: sql<number>`count(*)::int`,
        enabled: sql<number>`count(*) filter (where ${odooInstallations.enabled} = true)::int`,
        quarantined: sql<number>`count(*) filter (where ${odooInstallations.enabled} = false)::int`,
      }).from(odooInstallations),
    ]),
    8_000,
    "platformStatsAggregate",
  );

  const hourlyRows = (hourlyJobStats?.rows as PlatformHourlyJobStatsRow[] | undefined ?? []);
  const aggregatedJobs24h = hourlyRows.reduce(
    (acc, row) => ({
      total: acc.total + Number(row.total ?? 0),
      success: acc.success + Number(row.success ?? 0),
      failed: acc.failed + Number(row.failed ?? 0),
      queued: acc.queued + Number(row.queued ?? 0),
      inFlight: acc.inFlight + Number(row.inFlight ?? 0),
      expired: acc.expired + Number(row.expired ?? 0),
    }),
    { total: 0, success: 0, failed: 0, queued: 0, inFlight: 0, expired: 0 },
  );

  const responseBody = {
    tenants: tenantStats[0] ?? { total: 0, active: 0, suspended: 0, deleted: 0 },
    subscriptions: subscriptionStats[0] ?? { total: 0, active: 0, trialing: 0, pastDue: 0, incomplete: 0, incompleteExpired: 0, unpaid: 0, paused: 0, cancelled: 0, attention: 0 },
    users: userStats[0] ?? { total: 0, verified: 0 },
    agents: agentStats[0] ?? { total: 0, active: 0, online: 0, offline: 0, unknown: 0, inactive: 0 },
    printers: printerStats[0] ?? { total: 0, active: 0, online: 0, busy: 0, offline: 0, error: 0, unknown: 0, inactive: 0 },
    integrations: {
      keys: credentialStats[0] ?? { total: 0, active: 0, grace: 0, revoked: 0 },
      installations: installationStats[0] ?? { total: 0, enabled: 0, quarantined: 0 },
    },
    queueNow: liveQueueStats[0] ?? { queued: 0, inFlight: 0 },
    jobs24h: aggregatedJobs24h,
    jobs24hHourly: hourlyRows.map((row) => ({
      bucket: new Date(row.bucket).toISOString(),
      total: Number(row.total ?? 0),
      success: Number(row.success ?? 0),
      failed: Number(row.failed ?? 0),
      queued: Number(row.queued ?? 0),
      inFlight: Number(row.inFlight ?? 0),
      expired: Number(row.expired ?? 0),
    })),
  };

  setCachedPlatformStats(responseBody);

  return NextResponse.json(responseBody, {
    headers: { "X-Cache": "MISS", "Cache-Control": "private, no-store" },
  });
}
