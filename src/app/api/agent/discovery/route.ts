import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "../../../../db";
import { discoverySessions, discoveredDevices } from "../../../../db/schema";
import { validateAgent } from "../../../../lib/agent-auth";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { nanoid } from "../../../../lib/nanoid";
import { hasBodyOverLimit } from "../../../../lib/request-limits";
import { isPrivateNetworkAddress } from "../../../../lib/network-address";
import { requireActiveTenantInTransaction } from "../../../../lib/tenant-guard";
import { expireStaleAgentDiscovery } from "../../../../lib/discovery-session-expiry";
import { isVirtualPrinterRecord } from "../../../../lib/printer-virtual";
import { isExactPrinterId } from "../../../../lib/exact-printer-id";

export const dynamic = "force-dynamic";
const MAX_DISCOVERY_BODY_BYTES = 2 * 1024 * 1024;
const MAX_DISCOVERY_DEVICES = 1000;
const DISCOVERY_INSERT_BATCH = 250;

export async function GET(req: Request) {
  const agent = await validateAgent(req.headers.get("Authorization"));
  if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (agent.lifecycle !== "active") return NextResponse.json({ error: `Agent is ${agent.lifecycle}` }, { status: 409 });
  const rows = await db.transaction(async (tx) => {
    await requireActiveTenantInTransaction(tx, agent.tenantId);
    const locked = await tx.execute(sql`SELECT secret FROM agents
      WHERE id = ${agent.id} AND tenant_id = ${agent.tenantId} AND lifecycle = 'active' FOR SHARE`);
    if (!agent.secret || locked.rows[0]?.secret !== agent.secret) return null;
    await expireStaleAgentDiscovery((query) => tx.execute(query), agent.tenantId, agent.id);
    return tx.query.discoverySessions.findMany({ where: and(eq(discoverySessions.agentId, agent.id), eq(discoverySessions.tenantId, agent.tenantId), eq(discoverySessions.status, "running")), orderBy: [desc(discoverySessions.createdAt)], limit: 5 });
  });
  if (rows === null) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(rows);
}

const deviceSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  stableId: z.string().min(1).max(120).optional(),
  source: z.array(z.string().max(64)).max(32).optional(),
  protocol: z.string().min(1).max(32).optional(),
  ipAddress: z.string().max(45).optional(),
  hostname: z.string().max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  uri: z.string().max(1024).optional(),
  deviceName: z.string().max(255).optional(),
  spoolerName: z.string().max(255).optional(),
  deviceClass: z.enum(["thermal", "laser", "inkjet", "label", "other", "unknown"]).optional(),
  transport: z.string().max(32).optional(),
  manufacturer: z.string().max(120).optional(),
  model: z.string().max(255).optional(),
  serialNumber: z.string().max(120).optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  verification: z.enum(["candidate", "verified"]).optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  rawMetadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export async function POST(req: Request) {
  const agent = await validateAgent(req.headers.get("Authorization"));
  if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (agent.lifecycle !== "active") return NextResponse.json({ error: `Agent is ${agent.lifecycle}` }, { status: 409 });
  if (hasBodyOverLimit(req, MAX_DISCOVERY_BODY_BYTES)) return NextResponse.json({ error: "Request body too large" }, { status: 413 });

  let body: unknown;
  try { const parsedBody = await req.json(); if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) throw new Error("JSON object required"); body = parsedBody; } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const bodyRecord = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const discoveryId = typeof bodyRecord.discoveryId === "string" ? bodyRecord.discoveryId : null;
  const status = typeof bodyRecord.status === "string" ? bodyRecord.status : null;
  if (!status || !["running", "completed", "partial", "failed", "cancelled"].includes(status)) {
    return NextResponse.json({ error: "Invalid discovery report status" }, { status: 400 });
  }
  const chunkIndex = bodyRecord.chunkIndex;
  const chunkCount = bodyRecord.chunkCount;
  const hasChunk = chunkIndex !== undefined || chunkCount !== undefined;
  const isChunkOrdinal = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
  let chunkIndexValue: number | undefined;
  let chunkCountValue: number | undefined;
  if (hasChunk) {
    if (!isChunkOrdinal(chunkIndex) || !isChunkOrdinal(chunkCount)
      || chunkCount < 1 || chunkCount > 128
      || chunkIndex < 0 || chunkIndex >= chunkCount) {
      return NextResponse.json({ error: "Invalid discovery chunk sequence" }, { status: 400 });
    }
    chunkIndexValue = chunkIndex;
    chunkCountValue = chunkCount;
  }
  if (chunkIndexValue !== undefined && chunkCountValue !== undefined
    && (chunkIndexValue < chunkCountValue - 1 ? status !== "running" : status === "running")) {
    // A terminal first/middle page would close the row while more pages are
    // still in flight. The last page must always resolve a terminal outcome.
    return NextResponse.json({ error: "Only the final discovery chunk may be terminal" }, { status: 400 });
  }
  const totalCandidates = bodyRecord.totalCandidates;
  if (totalCandidates !== undefined && (!Number.isSafeInteger(totalCandidates)
    || (totalCandidates as number) < 0 || (totalCandidates as number) > 32_000)) {
    return NextResponse.json({ error: "Invalid discovery candidate count" }, { status: 400 });
  }
  const devices: unknown[] = Array.isArray(bodyRecord.devices) ? bodyRecord.devices : [];
  const errorsResult = z.array(z.string().max(2048)).max(64).safeParse(bodyRecord.errors ?? []);
  if (!errorsResult.success) return NextResponse.json({ error: "Invalid discovery source errors" }, { status: 400 });
  const sourceErrors = errorsResult.data;
  if (!discoveryId) return NextResponse.json({ error: "discoveryId required" }, { status: 400 });
  if (devices.length > MAX_DISCOVERY_DEVICES) return NextResponse.json({ error: `Too many devices in one discovery report; maximum is ${MAX_DISCOVERY_DEVICES}` }, { status: 413 });

  const parsedDevices = [] as Array<ReturnType<typeof deviceSchema.parse>>;
  const skippedDevices: Array<{ id: string; reason: string }> = [];
  for (const raw of devices) {
    const parsed = deviceSchema.safeParse(raw);
    const rawId = raw && typeof raw === "object" && !Array.isArray(raw) && typeof (raw as Record<string, unknown>).id === "string"
      ? String((raw as Record<string, unknown>).id)
      : "(unknown)";
    if (!parsed.success) {
      skippedDevices.push({ id: rawId, reason: `invalid_device: ${parsed.error.issues[0]?.message ?? "invalid payload"}` });
      continue;
    }
    const d = parsed.data;
    // Discovery IDs are also opaque execution identities. Trimming an
    // invalid ID here could merge two different discovered devices.
    if ((d.id !== undefined && !isExactPrinterId(d.id))
      || (d.stableId !== undefined && !isExactPrinterId(d.stableId))) {
      skippedDevices.push({ id: rawId, reason: "invalid_exact_printer_identity" });
      continue;
    }
    if (isVirtualPrinterRecord({ name: d.deviceName, spoolerName: d.spoolerName,
      connectionType: d.transport, protocol: d.protocol, deviceClass: d.deviceClass,
      capabilities: d.capabilities ?? d.rawMetadata, config: d.rawMetadata })) {
      skippedDevices.push({ id: d.id ?? rawId, reason: "virtual_or_software_printer" });
      continue;
    }
    const ip = parsed.data.ipAddress;
    if (ip && !isPrivateNetworkAddress(ip)) {
      skippedDevices.push({ id: parsed.data.id ?? rawId, reason: "invalid_ip: device IP must be private or link-local" });
      continue;
    }
    parsedDevices.push(parsed.data);
  }

  if (devices.length > 0 && parsedDevices.length === 0) {
    return NextResponse.json(
      { error: skippedDevices[0]?.reason ?? "No valid discovery devices were supplied" },
      { status: 400 },
    );
  }

  function identityKeyForDevice(d: ReturnType<typeof deviceSchema.parse>): string | null {
    const supplied = typeof d.stableId === "string" ? d.stableId : "";
    if (supplied) return supplied;
    const explicitId = typeof d.id === "string" ? d.id : "";
    if (explicitId) return explicitId;
    // Printer names, vendor and model are not unique execution identities.
    // Two identical printers can expose the same metadata on one Agent; an
    // identity derived from those fields silently aliases their approvals.
    // A missing local ID is only recoverable from an exact queue, URI,
    // host:port transport or serial-bearing hardware observation.
    const spooler = d.spoolerName?.trim();
    const uri = d.uri?.trim();
    const serial = d.serialNumber?.trim();
    const host = d.ipAddress?.trim() || d.hostname?.trim();
    if (!spooler && !uri && !serial && !(host && d.port)) return null;
    const fingerprint = [
      d.protocol ?? "",
      d.transport ?? "",
      d.ipAddress ?? "",
      d.port ?? "",
      uri ?? "",
      spooler ?? "",
      serial ?? "",
      d.hostname ?? "",
      d.manufacturer ?? "",
      d.model ?? "",
    ].map(String).join("\u001f");
    return createHash("sha256").update(fingerprint).digest("hex");
  }

  // Discovery is observation, not authorization. Approval is handled by the
  // manager endpoint before a discovered device can become a runtime printer.
  // Keep the report bounded and batch writes so one authenticated Agent cannot
  // force thousands of sequential database round trips in a single request.
  // identityKey is stable across repeated scans for the same Agent. The
  // database uniqueness boundary is tenant+agent+identity, so two Agents can
  // legitimately observe similar hardware without colliding.
  const rows = parsedDevices.map((d) => ({
    id: typeof d.id === "string" && d.id ? d.id : `dev_${nanoid(10)}`,
    identityKey: identityKeyForDevice(d),
    discoveryId,
    agentId: agent.id,
    source: d.source ?? [],
    protocol: d.protocol ?? "unknown",
    ipAddress: d.ipAddress ?? null,
    hostname: d.hostname ?? null,
    port: d.port ?? null,
    uri: d.uri ?? null,
    deviceName: d.deviceName ?? null,
    spoolerName: d.spoolerName ?? null,
    deviceClass: d.deviceClass ?? "unknown",
    transport: d.transport ?? null,
    manufacturer: d.manufacturer ?? null,
    model: d.model ?? null,
    serialNumber: d.serialNumber ?? null,
    confidence: "low" as const,
    verification: "candidate" as const,
    capabilities: d.capabilities ?? null,
    rawMetadata: d.rawMetadata ?? null,
    tenantId: agent.tenantId,
  }));
  // A stable ID is not proof that conflicting destinations are the same
  // device. Detect duplicate observations across the ENTIRE page, not only
  // each insert batch (which is otherwise last-write-wins at batch boundaries).
  // Accept an exact repeated observation once; reject every ambiguous row.
  const endpointOf = (row: (typeof rows)[number]): string => JSON.stringify([
    row.protocol, row.transport, row.ipAddress, row.port, row.uri,
    row.spoolerName, row.serialNumber,
  ]);
  const byIdentity = new Map<string, { endpoint: string; id: string; ambiguous: boolean }>();
  for (const row of rows) {
    const identity = row.identityKey;
    if (!identity) continue;
    const prior = byIdentity.get(identity);
    const endpoint = endpointOf(row);
    if (prior) {
      if (prior.endpoint !== endpoint || prior.id !== row.id) prior.ambiguous = true;
    } else byIdentity.set(identity, { endpoint, id: row.id, ambiguous: false });
  }
  const acceptedIdentity = new Set<string>();
  const unambiguousRows = rows.filter((row) => {
    if (!row.identityKey) {
      // Candidate-only discovery is still untrusted inventory. Persisting a
      // random dev_ ID for a name-only observation creates a new candidate
      // on every scan and invites accidental approval of an unbound device.
      // Keep its diagnostic in session stats, but no database identity.
      skippedDevices.push({ id: row.id, reason: "missing_execution_identity" });
      return false;
    }
    const evidence = byIdentity.get(row.identityKey)!;
    if (evidence.ambiguous) {
      skippedDevices.push({ id: row.id, reason: "discovery_identity_endpoint_conflict" });
      return false;
    }
    if (acceptedIdentity.has(row.identityKey)) return false;
    acceptedIdentity.add(row.identityKey);
    return true;
  });
  // A page's content must be the same across retries. A page index alone
  // cannot distinguish a lost HTTP ACK from an Agent restart/re-scan that
  // reordered devices while using the same discovery session id.
  const chunkDigest = chunkIndexValue !== undefined
    ? createHash("sha256").update(JSON.stringify(bodyRecord)).digest("hex")
    : null;
  const result = await db.transaction(async (tx) => {
    await requireActiveTenantInTransaction(tx, agent.tenantId);
    // Acquire resources in the same order as discovery-start and Agent
    // lifecycle writers: Tenant -> Agent -> Session -> Device. Otherwise a
    // report could hold the session while waiting for an Agent FK key-share
    // lock, as a manager holds that Agent while expiring this session.
    const lockedAgent = await tx.execute(sql`
      SELECT id, secret, lifecycle FROM agents
      WHERE id = ${agent.id} AND tenant_id = ${agent.tenantId}
      FOR SHARE
    `);
    const agentRow = lockedAgent.rows[0] as { id?: string; secret?: string; lifecycle?: string } | undefined;
    if (!agent.secret || !agentRow?.id || agentRow.secret !== agent.secret) {
      return { kind: "stale_credential" as const };
    }
    if (agentRow.lifecycle !== "active") {
      return { kind: "agent_inactive" as const };
    }
    // Serialize reporting against manager cancellation on the discovery session row.
    // Once this lock is held, the running-state check and all device/status writes
    // form one lifecycle decision: either the report lands before cancellation,
    // or cancellation wins and no late device report is accepted.
    const lockedSession = await tx.execute(sql`
      SELECT id, status, stats
      FROM discovery_sessions
      WHERE id = ${discoveryId}
        AND agent_id = ${agent.id}
        AND tenant_id = ${agent.tenantId}
      FOR UPDATE
    `);
    const currentSession = lockedSession.rows[0] as { id?: string; status?: string; stats?: unknown } | undefined;
    if (!currentSession?.id) return { kind: "not_found" as const };
    const previousStats = currentSession.stats && typeof currentSession.stats === "object" && !Array.isArray(currentSession.stats)
      ? currentSession.stats as Record<string, unknown> : {};
    const acceptedChunks = Array.isArray(previousStats.acceptedChunks)
      ? previousStats.acceptedChunks.filter((v): v is number => Number.isInteger(v) && typeof v === "number" && v >= 0 && v < 128)
      : [];
    if (chunkCountValue !== undefined && previousStats.chunkCount !== undefined && previousStats.chunkCount !== chunkCountValue) {
      return { kind: "chunk_conflict" as const };
    }
    // A gateway commit followed by a lost HTTP response must be replay-safe.
    // In-flight sessions from the earlier (index-only) schema may have no
    // digests; accept those for compatibility during their short lifetime.
    const chunkDigests = Array.isArray(previousStats.chunkDigests)
      ? previousStats.chunkDigests.map((value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : "")
      : [];
    if (chunkIndexValue !== undefined && acceptedChunks.includes(chunkIndexValue)) {
      const originalDigest = chunkDigests[chunkIndexValue];
      if (originalDigest && originalDigest !== chunkDigest) {
        return { kind: "chunk_replay_changed" as const };
      }
      // Also accept an identical replay of the final committed page after
      // the session has become terminal without writing devices or counters.
      return { kind: "ok" as const, insertedCount: 0, updatedCount: 0 };
    }
    if (currentSession.status !== "running") {
      return { kind: "not_running" as const, status: currentSession.status ?? "unknown" };
    }
    if (chunkIndexValue !== undefined && acceptedChunks.length !== chunkIndexValue) {
      return { kind: "chunk_conflict" as const };
    }

    let insertedCount = 0;
    let updatedCount = 0;

    for (let i = 0; i < unambiguousRows.length; i += DISCOVERY_INSERT_BATCH) {
      const batch = unambiguousRows.slice(i, i + DISCOVERY_INSERT_BATCH);
      // Identity deduplication already occurred across the entire report, so
      // no two batches can silently claim the same discovered destination.
      // The identity gate above excludes anonymous observations. Every
      // persistent row has an exact queue/URI/host:port/hardware-backed key;
      // a display name can never consume a random, unrepeatable candidate ID.
      if (batch.length > 0) {
        const upserted = await tx.insert(discoveredDevices)
          .values(batch)
          .onConflictDoUpdate({
            target: [discoveredDevices.tenantId, discoveredDevices.agentId, discoveredDevices.identityKey],
            // A repeated stable ID pointing to a DIFFERENT physical endpoint
            // is ambiguous, not an automatic destination migration. Preserve
            // the prior candidate and its approval/provisioning history.
            setWhere: sql`ROW(${discoveredDevices.protocol}, ${discoveredDevices.transport},
              ${discoveredDevices.ipAddress}, ${discoveredDevices.port}, ${discoveredDevices.uri},
              ${discoveredDevices.spoolerName}, ${discoveredDevices.serialNumber})
              IS NOT DISTINCT FROM ROW(excluded.protocol, excluded.transport,
              excluded.ip_address, excluded.port, excluded.uri,
              excluded.spooler_name, excluded.serial_number)`,
            set: {
              // Preserve the provisioned runtime link as history, but invalidate
              // operator approval when the authorized destination/capabilities change.
              // Refreshing the observation time alone is not a new configuration.
              // Keep every measurement, provenance and fingerprint in the comparison.
              candidateStatus: sql`CASE WHEN ${sql`ROW(${discoveredDevices.protocol}, ${discoveredDevices.ipAddress}, ${discoveredDevices.port}, ${discoveredDevices.uri}, ${discoveredDevices.spoolerName}, ${discoveredDevices.transport}, ${discoveredDevices.deviceClass}, (${discoveredDevices.capabilities} #- '{geometry,observed_at}' #- '{operational_verification,verified_at}'), ${discoveredDevices.deviceName}, ${discoveredDevices.model}, ${discoveredDevices.hostname}, ${discoveredDevices.manufacturer}, ${discoveredDevices.serialNumber}) IS DISTINCT FROM ROW(excluded.protocol, excluded.ip_address, excluded.port, excluded.uri, excluded.spooler_name, excluded.transport, excluded.device_class, (excluded.capabilities #- '{geometry,observed_at}' #- '{operational_verification,verified_at}'), excluded.device_name, excluded.model, excluded.hostname, excluded.manufacturer, excluded.serial_number)`} THEN 'discovered' ELSE ${discoveredDevices.candidateStatus} END`,
              verification: sql`CASE WHEN ${sql`ROW(${discoveredDevices.protocol}, ${discoveredDevices.ipAddress}, ${discoveredDevices.port}, ${discoveredDevices.uri}, ${discoveredDevices.spoolerName}, ${discoveredDevices.transport}, ${discoveredDevices.deviceClass}, (${discoveredDevices.capabilities} #- '{geometry,observed_at}' #- '{operational_verification,verified_at}'), ${discoveredDevices.deviceName}, ${discoveredDevices.model}, ${discoveredDevices.hostname}, ${discoveredDevices.manufacturer}, ${discoveredDevices.serialNumber}) IS DISTINCT FROM ROW(excluded.protocol, excluded.ip_address, excluded.port, excluded.uri, excluded.spooler_name, excluded.transport, excluded.device_class, (excluded.capabilities #- '{geometry,observed_at}' #- '{operational_verification,verified_at}'), excluded.device_name, excluded.model, excluded.hostname, excluded.manufacturer, excluded.serial_number)`} THEN 'candidate' ELSE ${discoveredDevices.verification} END`,
              discoveryId: sql`excluded.discovery_id`,
              source: sql`excluded.source`,
              protocol: sql`excluded.protocol`,
              ipAddress: sql`excluded.ip_address`,
              hostname: sql`excluded.hostname`,
              port: sql`excluded.port`,
              uri: sql`excluded.uri`,
              deviceName: sql`excluded.device_name`,
              spoolerName: sql`excluded.spooler_name`,
              deviceClass: sql`excluded.device_class`,
              transport: sql`excluded.transport`,
              manufacturer: sql`excluded.manufacturer`,
              model: sql`excluded.model`,
              serialNumber: sql`excluded.serial_number`,
              capabilities: sql`excluded.capabilities`,
              rawMetadata: sql`excluded.raw_metadata`,
              lastSeenAt: sql`now()`,
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: discoveredDevices.id, identityKey: discoveredDevices.identityKey, inserted: sql<boolean>`xmax = 0` });
        const retainedKeys = new Set(upserted.map((row) => row.identityKey));
        for (const row of batch) {
          if (row.identityKey && !retainedKeys.has(row.identityKey)) {
            skippedDevices.push({ id: row.id, reason: "discovery_identity_endpoint_changed" });
          }
        }
        insertedCount += upserted.filter((row) => row.inserted).length;
        updatedCount += upserted.filter((row) => !row.inserted).length;
      }
    }

    const countStat = (name: string) => typeof previousStats[name] === "number"
      && Number.isSafeInteger(previousStats[name]) && (previousStats[name] as number) >= 0
      ? previousStats[name] as number : 0;
    const totalSkipped = countStat("skipped") + skippedDevices.length;
    const mergedErrors = [...(Array.isArray(previousStats.errors)
      ? previousStats.errors.filter((e): e is string => typeof e === "string") : []), ...sourceErrors].slice(0, 64);
    const effectiveStatus =
      (totalSkipped > 0 || mergedErrors.length > 0) && status === "completed" ? "partial" : status;
    // Each accepted chunk updates the session under its row lock. Counters and
    // completion status survive an Agent restart/retry instead of reflecting
    // only the last chunk of a paginated discovery report.
    // Keep indexes aligned when continuing a pre-digest session from an older
    // Agent/Gateway version. Appending at acceptedChunks.length would store a
    // later page's digest at index zero, falsely rejecting a legacy retry.
    const nextChunkDigests = [...chunkDigests];
    const acceptedChunkIndex = chunkIndexValue;
    if (acceptedChunkIndex !== undefined && chunkDigest !== null) {
      while (nextChunkDigests.length <= acceptedChunkIndex) nextChunkDigests.push("");
      nextChunkDigests[acceptedChunkIndex] = chunkDigest;
    }
    const nextStats = {
      candidates: typeof totalCandidates === "number" ? totalCandidates : countStat("candidates") + devices.length,
      inserted: countStat("inserted") + insertedCount,
      updated: countStat("updated") + updatedCount,
      skipped: totalSkipped,
      errors: mergedErrors,
      ...(acceptedChunkIndex !== undefined && chunkCountValue !== undefined ? { chunkCount: chunkCountValue, acceptedChunks: [...acceptedChunks, acceptedChunkIndex], chunkDigests: nextChunkDigests } : {}),
    };
    const terminal = ["completed", "partial", "failed", "cancelled"].includes(effectiveStatus);
    await tx.update(discoverySessions)
      .set({
        ...(terminal ? { status: effectiveStatus, completedAt: sql`now()` } : {}),
        updatedAt: sql`now()`,
        stats: nextStats,
      })
      .where(and(eq(discoverySessions.id, discoveryId), eq(discoverySessions.agentId, agent.id), eq(discoverySessions.tenantId, agent.tenantId)));
    return { kind: "ok" as const, insertedCount, updatedCount };
  });

  if (result.kind === "not_found") return NextResponse.json({ error: "Discovery not found" }, { status: 404 });
  if (result.kind === "stale_credential") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (result.kind === "agent_inactive") return NextResponse.json({ error: "Agent is no longer active" }, { status: 409 });
  if (result.kind === "chunk_replay_changed") return NextResponse.json({ error: "Discovery page changed after its acknowledgment; start a new scan", code: "DISCOVERY_CHUNK_REPLAY_CHANGED" }, { status: 409 });
  if (result.kind === "not_running") return NextResponse.json({ error: `Discovery already ${result.status}` }, { status: 409 });
  if (result.kind === "chunk_conflict") return NextResponse.json({ error: "Discovery chunks must arrive in order for the same session", code: "DISCOVERY_CHUNK_CONFLICT" }, { status: 409 });
  return NextResponse.json({ ok: true, inserted: result.insertedCount, updated: result.updatedCount, skipped: skippedDevices, verification: "candidate-only" });
}
