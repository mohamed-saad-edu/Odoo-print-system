import { operationalVerificationProjection } from "../../../../lib/printer-operational-verification";
import { parseDbTimeMs } from "../../../../lib/database-timestamp";
import { db } from "../../../../db";
import { agents, printJobs, printers } from "../../../../db/schema";
import { validateAgent } from "../../../../lib/agent-auth";
import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { DEVICE_CLASSES, PRINTER_TYPES, CONNECTION_TYPES, PRINTER_PROTOCOLS, PRINTER_CONFIG_MAX_BYTES, PRINTER_CAPABILITIES_MAX_BYTES, validateConnectionConfig, validatePrinterTransportProtocol } from "../../../../lib/printer-model";
import { hasBodyOverLimit } from "../../../../lib/request-limits";
import { logError, logWarn } from "../../../../lib/log";
import { getTenantEntitlementLimit, isTenantBillingError, TenantEntitlementError } from "../../../../lib/entitlements";
import { requireActiveTenantInTransaction } from "../../../../lib/tenant-guard";
import { aliasPrinterIdForAgent } from "../../../../lib/printer-identity";
import { physicalPrinterIdentityKey, samePrinterProtocol } from "../../../../lib/physical-printer-identity";
import { isExactPrinterId } from "../../../../lib/exact-printer-id";
import { inventoryVersionAllowsPage, parseInventorySnapshotVersion } from "../../../../lib/inventory-snapshot";
import { getDesiredPrinterPage } from "../../../../lib/desired-state-page";
import { isVirtualPrinterRecord } from "../../../../lib/printer-virtual";
import { PRINTER_NOT_SHARED_PAUSE } from "../../../../lib/job-status";
import { validatePrinterGeometry } from "../../../../lib/printer-geometry";

const MAX_HEARTBEAT_BODY_BYTES = 512 * 1024;
const MAX_KEEP_ALIVE_JOB_IDS = 64;
const VALID_PRINTER_STATUSES = new Set(["online", "offline", "busy", "error", "unknown"]);
const KNOWN_CAPABILITY_TOKENS = new Set([
  "raw",
  "escpos",
  "zpl",
  "tspl",
  "pdf",
  "image",
  "jpeg",
  "spooler",
  "windows_spooler",
  "ipp",
  "ipps",
  "unknown",
]);
const VALID_AGENT_STATUSES = new Set(["online", "offline"]);

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

type DesiredStateAck = { printerId?: unknown; appliedDesiredRevision?: unknown; observedDesiredRevision?: unknown };

type ReportedPrinter = {
  id?: unknown;
  name?: unknown;
  displayName?: unknown;
  spoolerName?: unknown;
  endpoint?: unknown;
  type?: unknown;
  printerType?: unknown;
  deviceClass?: unknown;
  connectionType?: unknown;
  protocol?: unknown;
  status?: unknown;
  enabled?: unknown;
  sharedWithGateway?: unknown;
  config?: unknown;
  capabilities?: unknown;
};

function normalizeConnectionType(raw?: unknown, legacy?: unknown): string | null {
  const normalize = (value: unknown): string => {
    const candidate = typeof value === "string" ? value.toLowerCase().trim() : "";
    if (candidate === "tcp") return "network";
    if (candidate === "windows_spooler") return "spooler";
    return candidate;
  };
  const canonical = normalize(raw);
  const normalizedOld = normalize(legacy);
  if (canonical && normalizedOld && canonical !== normalizedOld) return null;
  const value = canonical || normalizedOld;
  return CONNECTION_TYPES.includes(value as (typeof CONNECTION_TYPES)[number]) ? value : null;
}

function normalizeProtocol(raw?: unknown): string | null {
  const p = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  const normalized = p === "windows_spooler" ? "spooler" : p;
  return PRINTER_PROTOCOLS.includes(normalized as (typeof PRINTER_PROTOCOLS)[number]) && normalized ? normalized : null;
}

function sanitizePrinter(p: ReportedPrinter): {
  ok: true;
  printer: {
    id: string;
    name: string;
    printerType: string;
    deviceClass: string;
    connectionType: string;
    protocol: string;
    status: string;
    sharedWithGateway?: true;
    config: Record<string, unknown>;
    capabilities: Record<string, unknown> | null;
  };
} | { ok: false; reason: string } {
  if (!p || typeof p !== "object" || Array.isArray(p)) return { ok: false, reason: "invalid_printer" };
  if (!isExactPrinterId(p.id)) return { ok: false, reason: "invalid_id" };
  if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 100) return { ok: false, reason: "invalid_name" };
  if (p.sharedWithGateway !== undefined && p.sharedWithGateway !== true) return { ok: false, reason: "invalid_shared_with_gateway" };
  const connectionType = normalizeConnectionType(p.connectionType, p.type);
  if (!connectionType) return { ok: false, reason: "invalid_or_unsupported_connection_type" };
  let printerType = typeof p.printerType === "string" ? p.printerType.trim().toLowerCase() : "";
  let deviceClass = typeof p.deviceClass === "string" ? p.deviceClass.trim().toLowerCase() : "unknown";
  if (!(PRINTER_TYPES as readonly string[]).includes(printerType) && (DEVICE_CLASSES as readonly string[]).includes(printerType)) {
    deviceClass = printerType;
    printerType = "physical";
  }
  if (!printerType) printerType = "physical";
  if (!(PRINTER_TYPES as readonly string[]).includes(printerType) || !(DEVICE_CLASSES as readonly string[]).includes(deviceClass)) return { ok: false, reason: "invalid_device_class_or_printer_type" };
  if ((printerType === "file") !== (connectionType === "pdf_output")) return { ok: false, reason: "invalid_output_type" };
  let protocol = normalizeProtocol(p.protocol ?? (p.config as Record<string, unknown>)?.protocol);
  if (!protocol) return { ok: false, reason: "invalid_or_unsupported_protocol" };
  const config = p.config && typeof p.config === "object" ? { ...(p.config as Record<string, unknown>) } : {};
  delete config.protocol;
  let canonicalConnectionType = connectionType;
  if (
    canonicalConnectionType === "usb" &&
    typeof config.spooler_name === "string" &&
    config.spooler_name.trim()
  ) {
    canonicalConnectionType = "spooler";
    protocol = "spooler";
    config.address = config.spooler_name.trim();
  }
  let capabilities = p.capabilities && typeof p.capabilities === "object" ? { ...(p.capabilities as Record<string, unknown>) } : null;
  if (capabilities && "geometry" in capabilities) {
    const geometry = validatePrinterGeometry(capabilities.geometry, { printerId: p.id });
    if (geometry.ok) {
      capabilities.geometry = geometry.value;
      delete capabilities.geometry_error;
    } else {
      // Preserve ordinary document transport inventory; only geometry-based
      // image output is unavailable until a valid observation arrives.
      delete capabilities.geometry;
      capabilities.geometry_error = geometry.reason;
    }
  }
  if (capabilities && "supported_protocols" in capabilities) {
    // Presence is authoritative: an explicitly empty/invalid list means the
    // device declares no supported payload protocols. Do not delete the key,
    // because deletion would silently restore transport-based fallback.
    if (Array.isArray(capabilities.supported_protocols)) {
      capabilities.supported_protocols = (capabilities.supported_protocols as unknown[])
        .map((value) => String(value).toLowerCase().trim())
        .filter((token) => KNOWN_CAPABILITY_TOKENS.has(token));
    } else {
      // Presence is authoritative. A malformed supported_protocols value is
      // rejected rather than erased, because erasing it would restore
      // transport-based fallback and could broaden what this device can
      // receive. The routing layer intentionally fails closed on this shape.
      return { ok: false, reason: "invalid_supported_protocols" };
    }
  }
  if (isVirtualPrinterRecord({ name: p.name, printerType, deviceClass,
    displayName: typeof p.displayName === "string" ? p.displayName : undefined,
    spoolerName: typeof p.spoolerName === "string" ? p.spoolerName : undefined,
    endpoint: typeof p.endpoint === "string" ? p.endpoint : undefined,
    connectionType: canonicalConnectionType, protocol, capabilities, config })) {
    return { ok: false, reason: "virtual_or_software_printer" };
  }
  const status = typeof p.status === "string" && VALID_PRINTER_STATUSES.has(p.status.trim().toLowerCase()) ? p.status.trim().toLowerCase() : "unknown";
  if (utf8ByteLength(JSON.stringify(config)) > PRINTER_CONFIG_MAX_BYTES) return { ok: false, reason: "config_payload_too_large" };
  if (capabilities && utf8ByteLength(JSON.stringify(capabilities)) > PRINTER_CAPABILITIES_MAX_BYTES) return { ok: false, reason: "capabilities_payload_too_large" };
  const configErr = validateConnectionConfig(canonicalConnectionType, config, protocol);
  if (configErr) return { ok: false, reason: `invalid_connection_config: ${configErr}` };
  const transportProtocolErr = validatePrinterTransportProtocol(canonicalConnectionType, protocol);
  if (transportProtocolErr) return { ok: false, reason: `invalid_transport_protocol: ${transportProtocolErr}` };
  return { ok: true, printer: { id: p.id, name: p.name.trim(), printerType, deviceClass, connectionType: canonicalConnectionType, protocol, status, config, capabilities, ...(p.sharedWithGateway === true ? { sharedWithGateway: true as const } : {}) } };
}

export async function POST(req: Request) {
  const agent = await validateAgent(req.headers.get("Authorization"));
  if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (agent.lifecycle !== "active") return NextResponse.json({ error: `Agent is ${agent.lifecycle}` }, { status: 409 });
  if (hasBodyOverLimit(req, MAX_HEARTBEAT_BODY_BYTES)) return NextResponse.json({ error: "Request body too large" }, { status: 413 });

  let body: { status?: unknown; heartbeatPage?: unknown; heartbeatPageCount?: unknown; inventorySnapshotId?: unknown; inventorySnapshotVersion?: unknown; inventoryComplete?: unknown; desiredStatePaging?: unknown; printers?: unknown; privatePrinterIds?: unknown; gatewayOwnedPrinterIds?: unknown; keepAliveJobIds?: unknown; desiredStateAcks?: unknown };
  try {
    const parsedBody = await req.json(); if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) throw new Error("JSON object required"); body = parsedBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const rawStatus = typeof body?.status === "string" ? body.status.trim().toLowerCase() : "online";
    if (!VALID_AGENT_STATUSES.has(rawStatus)) return NextResponse.json({ error: "status must be online or offline" }, { status: 400 });
    const status = rawStatus;
    const heartbeatPageRaw = body?.heartbeatPage;
    const heartbeatPageCountRaw = body?.heartbeatPageCount;
    const paginatedHeartbeat = heartbeatPageRaw !== undefined || heartbeatPageCountRaw !== undefined;
    const heartbeatPage = paginatedHeartbeat
      ? (typeof heartbeatPageRaw === "number" && Number.isSafeInteger(heartbeatPageRaw) ? heartbeatPageRaw : -1)
      : 1;
    const heartbeatPageCount = paginatedHeartbeat
      ? (typeof heartbeatPageCountRaw === "number" && Number.isSafeInteger(heartbeatPageCountRaw) ? heartbeatPageCountRaw : -1)
      : 1;
    if (
      heartbeatPage < 1 ||
      heartbeatPageCount < 1 ||
      heartbeatPage > heartbeatPageCount
    ) {
      return NextResponse.json({
        error: "heartbeatPage and heartbeatPageCount must be positive integers with heartbeatPage <= heartbeatPageCount",
      }, { status: 400 });
    }
    const isFinalHeartbeatPage = heartbeatPage === heartbeatPageCount;
    const rawSnapshotId = body?.inventorySnapshotId;
    const inventorySnapshotId = typeof rawSnapshotId === "string" ? rawSnapshotId.trim() : "";
    if (rawSnapshotId !== undefined && (!inventorySnapshotId || inventorySnapshotId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(inventorySnapshotId))) {
      return NextResponse.json({ error: "inventorySnapshotId must be a non-empty safe token up to 128 characters" }, { status: 400 });
    }
    if (body?.inventoryComplete !== undefined && typeof body.inventoryComplete !== "boolean") {
      return NextResponse.json({ error: "inventoryComplete must be boolean" }, { status: 400 });
    }
    const inventoryComplete = body?.inventoryComplete === true;
    if (inventoryComplete && !inventorySnapshotId) {
      return NextResponse.json({ error: "inventoryComplete requires inventorySnapshotId" }, { status: 400 });
    }
    const inventorySnapshotVersion = parseInventorySnapshotVersion(body.inventorySnapshotVersion);
    if (body.inventorySnapshotVersion !== undefined && (!inventorySnapshotVersion || !inventorySnapshotId)) {
      return NextResponse.json({ error: "inventorySnapshotVersion requires inventorySnapshotId and a positive int64 decimal string" }, { status: 400 });
    }
    if (body.desiredStatePaging !== undefined && typeof body.desiredStatePaging !== "boolean") {
      return NextResponse.json({ error: "desiredStatePaging must be boolean" }, { status: 400 });
    }
    const desiredStatePaging = body.desiredStatePaging === true;

    if ((body.printers !== undefined || inventoryComplete) && !Array.isArray(body.printers)) {
      return NextResponse.json({ error: "printers must be an array for an inventory snapshot" }, { status: 400 });
    }
    const reportedPrinters = Array.isArray(body?.printers) ? body.printers : [];
    // 500 is a transport page ceiling, not a fleet-size ceiling. Agents with
    // larger inventories send multiple pages; no printer may be silently
    // discarded just because the fleet exceeds one request.
    if (reportedPrinters.length > 500) return NextResponse.json({ error: "too many printers in heartbeat page" }, { status: 400 });
    if (utf8ByteLength(JSON.stringify(reportedPrinters)) > 256_000) return NextResponse.json({ error: "heartbeat printer metadata page exceeds 256KB" }, { status: 400 });
    const hasSharingControls = body.privatePrinterIds !== undefined || reportedPrinters.some((printer) =>
      printer && typeof printer === "object" && Object.prototype.hasOwnProperty.call(printer, "sharedWithGateway"));
    if (hasSharingControls && (!paginatedHeartbeat || !inventorySnapshotId || !inventorySnapshotVersion)) {
      return NextResponse.json({ error: "Printer sharing controls require a versioned paginated inventory snapshot" }, { status: 400 });
    }

    const privatePrinterIds = new Set<string>();
    if (body.privatePrinterIds !== undefined) {
      if (!Array.isArray(body.privatePrinterIds) || body.privatePrinterIds.length > 500) {
        return NextResponse.json({ error: "privatePrinterIds must be an array of at most 500 printer IDs" }, { status: 400 });
      }
      for (const value of body.privatePrinterIds) {
        if (!isExactPrinterId(value)) {
          return NextResponse.json({ error: "privatePrinterIds must contain non-empty printer IDs up to 120 UTF-8 bytes" }, { status: 400 });
        }
        const localId = value;
        privatePrinterIds.add(localId);
        // Negative local sharing authority must follow the canonical ID the
        // Gateway assigned after a cross-Agent collision. The reporting Agent
        // deliberately keeps its original local ID; it does not know whether
        // that ID is the bare tenant ID or its per-Agent cloud alias.
        // The UPDATE below remains scoped to this authenticated tenant+Agent,
        // so a denied ID can never hide another Agent's physical printer.
        privatePrinterIds.add(aliasPrinterIdForAgent(localId, agent.id));
      }
    }

    const gatewayOwnedPrinterIds = new Set<string>();
    if (Array.isArray(body?.gatewayOwnedPrinterIds)) {
      if (body.gatewayOwnedPrinterIds.length > 500) {
        return NextResponse.json({ error: "too many Gateway-owned printer IDs in heartbeat" }, { status: 400 });
      }
      for (const rawId of body.gatewayOwnedPrinterIds) {
        if (isExactPrinterId(rawId)) {
          gatewayOwnedPrinterIds.add(rawId);
        }
      }
    }

    const rawKeepAlive: unknown[] = Array.isArray(body?.keepAliveJobIds) ? (body.keepAliveJobIds as unknown[]) : [];
    const pairs: Array<{ jobId: string; claimToken: string | null }> = [];
    for (const entry of rawKeepAlive) {
      if (typeof entry === "string") {
        if (entry.length > 0 && entry.length <= 120) pairs.push({ jobId: entry, claimToken: null });
      } else if (entry && typeof entry === "object") {
        const rec = entry as Record<string, unknown>;
        const jobId = typeof rec.jobId === "string" ? rec.jobId : typeof rec.id === "string" ? rec.id : "";
        const claimToken = typeof rec.claimToken === "string" && rec.claimToken.length > 0 && rec.claimToken.length <= 120 ? rec.claimToken : null;
        if (jobId.length > 0 && jobId.length <= 120) pairs.push({ jobId, claimToken });
      }
      if (pairs.length >= MAX_KEEP_ALIVE_JOB_IDS) break;
    }
    // Lease refresh is execution-fenced. Tokenless legacy keep-alives are not
    // allowed to extend a claim because they have no proof of current attempt
    // ownership; those rows must remain recoverable by the stale-claim sweeper.
    const tokened = pairs.filter((p): p is { jobId: string; claimToken: string } => p.claimToken !== null);

    const result = await db.transaction(async (tx) => {
      await requireActiveTenantInTransaction(tx, agent.tenantId);
      // Printer admission and inventory snapshots share the same tenant lock as
      // explicit printer registration. Lock it BEFORE the Agent row to keep the
      // lock order consistent and prevent count/insert races or deadlocks.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('printers:' || ${agent.tenantId}))`);

      // Lifecycle transitions lock the same agent row. Holding this lock for the
      // complete heartbeat makes status, lease refresh, desired-state ACKs and
      // printer observations linearize before OR after a disable/retire.
      const lockedAgent = await tx.execute(sql`
        SELECT id, lifecycle, inventory_snapshot_id, inventory_snapshot_version, inventory_snapshot_page_count,
               inventory_snapshot_next_page, inventory_snapshot_complete, inventory_snapshot_had_errors
        FROM agents
        WHERE id = ${agent.id} AND tenant_id = ${agent.tenantId}
        FOR UPDATE
      `);
      const currentAgent = lockedAgent.rows[0] as {
        id?: string; lifecycle?: unknown; inventory_snapshot_id?: unknown;
        inventory_snapshot_page_count?: unknown; inventory_snapshot_next_page?: unknown;
        inventory_snapshot_complete?: unknown; inventory_snapshot_had_errors?: unknown;
        inventory_snapshot_version?: string;
      } | undefined;
      if (!currentAgent?.id) return { kind: "missing" as const };
      if (currentAgent.lifecycle !== "active") return { kind: "inactive" as const, lifecycle: String(currentAgent.lifecycle) };

      const snapshotEnabled = inventorySnapshotId.length > 0;
      const retainedVersion = currentAgent.inventory_snapshot_version ?? "0";
      // A page-1 replay must be rejected even after its final page cleared the
      // in-progress ID. Keep the high-water mark for the lifetime of the Agent.
      if (!inventoryVersionAllowsPage(inventorySnapshotVersion, retainedVersion, heartbeatPage)) {
        return { kind: "inventory_conflict" as const, expectedPage: Number(currentAgent.inventory_snapshot_next_page ?? 1), minimumSnapshotVersion: retainedVersion };
      }
      const priorSnapshotHadErrors = heartbeatPage === 1 ? false : currentAgent.inventory_snapshot_had_errors === true;
      if (snapshotEnabled && heartbeatPage > 1) {
        const activeSnapshotId = typeof currentAgent.inventory_snapshot_id === "string" ? currentAgent.inventory_snapshot_id : "";
        const activePageCount = Number(currentAgent.inventory_snapshot_page_count ?? 0);
        const expectedPage = Number(currentAgent.inventory_snapshot_next_page ?? 0);
        const activeComplete = currentAgent.inventory_snapshot_complete === true;
        if (activeSnapshotId !== inventorySnapshotId || activePageCount !== heartbeatPageCount || expectedPage !== heartbeatPage || activeComplete !== inventoryComplete) {
          return { kind: "inventory_conflict" as const, expectedPage, minimumSnapshotVersion: retainedVersion };
        }
      }

      await tx.update(agents)
        .set({ status, lastSeenAt: sql`now()` })
        .where(and(eq(agents.id, agent.id), eq(agents.tenantId, agent.tenantId), eq(agents.lifecycle, "active")));

      if (tokened.length > 0) {
        const tuples = tokened.map((p) => sql`(${p.jobId}, ${p.claimToken})`);
        const list = tuples.length === 1 ? tuples[0]! : sql.join(tuples, sql`, `);
        await tx.execute(sql`
          UPDATE print_jobs SET updated_at = now()
          WHERE tenant_id = ${agent.tenantId}
            AND agent_id = ${agent.id}
            AND status IN ('claimed', 'printing')
            AND (id, claim_token) IN (${list})
        `);
      }
      const desiredStateAcks = Array.isArray(body?.desiredStateAcks) ? (body.desiredStateAcks as unknown[]).slice(0, 500) : [];
      for (const rawAck of desiredStateAcks) {
        if (!rawAck || typeof rawAck !== "object") continue;
        const ack = rawAck as DesiredStateAck;
        const printerId = typeof ack.printerId === "string" ? ack.printerId.trim() : "";
        const applied = typeof ack.appliedDesiredRevision === "number" && Number.isSafeInteger(ack.appliedDesiredRevision) && ack.appliedDesiredRevision >= 0 ? ack.appliedDesiredRevision : -1;
        const observed = typeof ack.observedDesiredRevision === "number" && Number.isSafeInteger(ack.observedDesiredRevision) && ack.observedDesiredRevision >= 0 ? ack.observedDesiredRevision : -1;
        if (!printerId || applied < 0 || observed < 0) continue;
        await tx.update(printers).set({
          appliedDesiredRevision: sql`LEAST(${printers.desiredRevision}, GREATEST(${printers.appliedDesiredRevision}, ${applied}))`,
          observedDesiredRevision: sql`LEAST(${printers.desiredRevision}, GREATEST(${printers.observedDesiredRevision}, LEAST(${observed}, GREATEST(${printers.appliedDesiredRevision}, ${applied}))))`,
        }).where(and(
          eq(printers.id, printerId),
          eq(printers.tenantId, agent.tenantId),
          eq(printers.agentId, agent.id),
          eq(printers.managementSource, "manager"),
        ));
      }

      const skipped: Array<{ id: string; reason: string }> = [];
      // Negative local-owner policy takes effect under the same authenticated
      // snapshot/Agent fence as observations. Unknown/foreign IDs are ignored;
      // private discovery never registers a name or changes remote lifecycle.
      if (privatePrinterIds.size > 0) {
        await tx.update(printers).set({ sharedWithGateway: false, sharedWithGatewayVersion: inventorySnapshotVersion, updatedAt: sql`now()` })
          .where(and(eq(printers.tenantId, agent.tenantId), eq(printers.agentId, agent.id), inArray(printers.id, [...privatePrinterIds]),
            sql`(${printers.sharedWithGatewayVersion} IS NULL OR ${printers.sharedWithGatewayVersion}::numeric <= ${inventorySnapshotVersion}::numeric)`));
      }
      type SanitizedPrinter = Extract<ReturnType<typeof sanitizePrinter>, { ok: true }>["printer"];
      const sanitizedPrinters: SanitizedPrinter[] = [];
      for (const raw of reportedPrinters) {
        const rawId = typeof raw?.id === "string" ? raw.id : "(unknown)";
        // Explicit denial wins a contradictory report; do not adopt its name.
        if (typeof rawId === "string" && privatePrinterIds.has(rawId)) continue;
        const res = sanitizePrinter(raw);
        if (!res.ok) {
          skipped.push({ id: rawId, reason: res.reason });
          continue;
        }
        sanitizedPrinters.push(res.printer);
      }

      // Existing active observations must remain fresh even when the tenant is
      // at its printer limit. Capacity is consumed, however, whenever Agent
      // inventory transitions from absent -> present, not only when a brand-new
      // database ID is inserted. Otherwise a tombstoned stable ID can reappear
      // after a replacement consumes its slot and silently exceed max_printers.
      //
      // Cross-agent identity: local stable IDs derive from local coordinates,
      // so two agents in one tenant can report the same ID for distinct
      // physical devices. The row owner keeps the bare ID; colliding
      // reporters move to their deterministic per-agent alias BEFORE any
      // inventory read, so every check below operates on stored identities
      // and existing unambiguous mappings never change.
      const reportedLocalIds = [...new Set(sanitizedPrinters.map(p => p.id))];
      const localRows = reportedLocalIds.length ? await tx.query.printers.findMany({
        where: and(eq(printers.tenantId, agent.tenantId), inArray(printers.id, reportedLocalIds)),
      }) : [];
      const localById = new Map(localRows.map(p => [p.id, p]));
      const printerIdAliases: Record<string, string> = {};
      for (const p of sanitizedPrinters) {
        const existing = localById.get(p.id);
        if (existing && existing.agentId !== agent.id) {
          const alias = aliasPrinterIdForAgent(p.id, agent.id);
          printerIdAliases[p.id] = alias;
          p.id = alias;
          // The Agent must adopt its alias and publish a new bound geometry.
          // Rewriting printer_id here would forge the Agent's provenance.
          if (p.capabilities) {
            delete p.capabilities.geometry;
            delete p.capabilities.operational_verification;
            p.capabilities.geometry_error = "Printer identity is changing; refresh geometry after alias adoption";
          }
        }
      }
      // The Agent may know the canonical alias while the observation still
      // carries a local ID. Denial wins after alias resolution as well.
      for (let index = sanitizedPrinters.length - 1; index >= 0; index -= 1) {
        if (privatePrinterIds.has(sanitizedPrinters[index]!.id)) sanitizedPrinters.splice(index, 1);
      }
      // Check the physical endpoint, not only the Agent-generated row ID:
      // manual registration and discovery can report identical printers under
      // different IDs. Preserve the existing row and all accepted job history.
      const knownPhysicalPrinters = sanitizedPrinters.length > 0
        ? await tx.query.printers.findMany({
            where: and(eq(printers.tenantId, agent.tenantId), eq(printers.agentId, agent.id)),
          })
        : [];
      // Deterministic existing-row precedence: an explicit removal/withholding
      // policy wins first, then manager ownership, then the oldest stable ID.
      // Never backfill two legacy duplicate rows with the same partial-unique
      // endpoint key; the historical duplicate keeps its NULL identity.
      const rowPriority = (row: (typeof knownPhysicalPrinters)[number]) => [
        row.lifecycle === "retired" || row.sharedWithGateway === false ? 0 : 1,
        row.managementSource === "manager" ? 0 : 1,
        row.createdAt.getTime(),
        row.id,
      ] as const;
      knownPhysicalPrinters.sort((a, b) => {
        const aa = rowPriority(a), bb = rowPriority(b);
        for (let part = 0; part < aa.length; part++) {
          if (aa[part] < bb[part]) return -1;
          if (aa[part] > bb[part]) return 1;
        }
        return 0;
      });
      const knownByEndpoint = new Map<string, (typeof knownPhysicalPrinters)[number]>();
      for (const row of knownPhysicalPrinters) {
        // Stored identity hashes are only hints: if the live endpoint cannot
        // be reconstructed, do not suppress or bind an observation to an
        // unrelated printer using a stale historical key.
        const endpoint = physicalPrinterIdentityKey(row);
        if (endpoint && !knownByEndpoint.has(endpoint)) knownByEndpoint.set(endpoint, row);
      }
      const seenEndpoints = new Set<string>();
      // O(known inventory + reported page), not O(known * reported). Snapshot
      // input is capped to 500 rows but tenant fleets can be substantially larger.
      for (let i = sanitizedPrinters.length - 1; i >= 0; i--) {
        const observed = sanitizedPrinters[i]!;
        const key = physicalPrinterIdentityKey(observed);
        if (!key) continue;
        const match = knownByEndpoint.get(key);
        if (match && match.id !== observed.id) {
          skipped.push({ id: observed.id, reason: samePrinterProtocol(match, observed)
            ? "duplicate_physical_endpoint_registered_as_" + match.id
            : "physical_endpoint_protocol_conflict" });
          sanitizedPrinters.splice(i, 1);
        } else if (seenEndpoints.has(key)) {
          skipped.push({ id: observed.id, reason: "duplicate_physical_endpoint_in_snapshot" });
          sanitizedPrinters.splice(i, 1);
        } else seenEndpoints.add(key);
      }
      const inventoryIds = [...new Set(sanitizedPrinters.map(p => p.id))];
      const inventoryRows = inventoryIds.length ? await tx.query.printers.findMany({
        where: and(eq(printers.tenantId, agent.tenantId), inArray(printers.id, inventoryIds)),
      }) : [];
      const inventoryById = new Map(inventoryRows.map(p => [p.id, p]));
      const clockRow = await tx.execute(sql`SELECT clock_timestamp() AS verification_now`);
      const verificationNowMs = parseDbTimeMs(clockRow.rows[0]?.verification_now as Date | string | null);
      if (verificationNowMs === null) throw new Error("Database verification clock unavailable");
      const verificationNow = new Date(verificationNowMs);
      const verificationById = new Map<string, ReturnType<typeof operationalVerificationProjection>>();
      const logicalOwners = new Map(knownPhysicalPrinters.filter(row => row.logicalQueueKey).map(row => [row.logicalQueueKey!, row.id]));
      const identityConflicts = new Set<string>();
      for (const p of sanitizedPrinters) {
        const existing = inventoryById.get(p.id);
        let projection = operationalVerificationProjection(p.capabilities?.operational_verification, p, verificationNow);
        if (existing?.managementSource === "manager") {
          const destination = physicalPrinterIdentityKey(existing);
          if (!destination || destination !== physicalPrinterIdentityKey(p) || !samePrinterProtocol(existing, p)) {
            projection = { ...operationalVerificationProjection(null, p, verificationNow), verificationReason: "verification_destination_mismatch" };
          } else if (existing.appliedDesiredRevision < existing.desiredRevision || existing.observedDesiredRevision < existing.desiredRevision) {
            projection = { ...operationalVerificationProjection(null, p, verificationNow), verificationReason: "verification_configuration_pending" };
          }
        }
        if (projection.verificationState === "verified") {
          const owner = logicalOwners.get(projection.logicalQueueKey);
          if (owner && owner !== p.id) {
            identityConflicts.add(owner); identityConflicts.add(p.id);
            skipped.push({ id: p.id, reason: "logical_queue_identity_collision" });
          } else logicalOwners.set(projection.logicalQueueKey, p.id);
        }
        verificationById.set(p.id, projection);
      }
      // Do not choose one of two contradictory identity claims. Retain both
      // registration histories and the established unique key, but pause work.
      for (const id of identityConflicts) {
        verificationById.set(id, { ...operationalVerificationProjection(null, { id }, verificationNow), verificationReason: "verification_identity_collision" });
        await tx.update(printers).set({ verificationState: "pending", verificationVerifiedAt: null, verificationReceivedAt: null, verificationBindingDigest: null, verificationReason: "verification_identity_collision" })
          .where(and(eq(printers.tenantId, agent.tenantId), eq(printers.agentId, agent.id), eq(printers.id, id)));
      }

      let pageHadErrors = skipped.length > 0;
      const mayUpdateSharing = (p: SanitizedPrinter, existing: typeof printers.$inferSelect): boolean => {
        // A platform-removed or retired printer is an irreversible negative
        // tombstone; even a newer Agent snapshot may not re-share it.
        if (existing.lifecycle === "retired") return false;
        if (p.sharedWithGateway !== true || !inventorySnapshotVersion) return false;
        if (existing.sharedWithGatewayVersion == null) return true;
        const incoming = BigInt(inventorySnapshotVersion);
        const retained = BigInt(existing.sharedWithGatewayVersion);
        // A duplicate page cannot release a hand-back pause created after an
        // earlier observation from this same snapshot. New permission needs
        // new evidence even if the canonical policy is already shared.
        return incoming > retained;
      };
      const observedCapabilities = (p: SanitizedPrinter, existing: typeof printers.$inferSelect) => {
        const capabilities = p.capabilities ? { ...p.capabilities } : null;
        if (capabilities && verificationById.get(p.id)?.verificationState !== "verified") delete capabilities.operational_verification;
        if (!capabilities?.geometry || existing.managementSource !== "manager") return capabilities;
        const desiredEndpoint = physicalPrinterIdentityKey(existing);
        const observedEndpoint = physicalPrinterIdentityKey(p);
        if (!samePrinterProtocol(existing, p)
            || (desiredEndpoint !== null && observedEndpoint !== null && desiredEndpoint !== observedEndpoint)) {
          delete capabilities.geometry;
          capabilities.geometry_error = "Geometry was observed for a previous printer destination or protocol";
        }
        return capabilities;
      };

      const capacityCandidateIds = [...new Set(
        sanitizedPrinters
          .map((p) => {
            const existing = inventoryById.get(p.id);
            if (!existing) return gatewayOwnedPrinterIds.has(p.id) ? null : p.id;
            if (existing.agentId !== agent.id) return null;
            if (existing.lifecycle === "retired") return null;
            if (existing.sharedWithGateway === false) return mayUpdateSharing(p, existing) ? p.id : null;
            if (existing.managementSource !== "agent") return null;
            if (existing.inventoryPresent !== false) return null;
            return p.id;
          })
          .filter((id): id is string => id !== null),
      )].sort();
      const overLimitIds = new Set<string>();
      const positivelySharedIds: string[] = [];
      // Billing/entitlement failure must not abort the heartbeat transport:
      // presence, lease keep-alives and desired-state ACKs (already written
      // above) commit regardless. New/reactivated inventory is fenced while
      // billing is unresolved, and the response carries billingBlocked so
      // operators can distinguish "agent dead" from "plan lapsed".
      let billingBlocked = false;
      if (capacityCandidateIds.length > 0) {
        let printerLimit: number | null = null;
        try {
          printerLimit = await getTenantEntitlementLimit(tx, agent.tenantId, "max_printers", true);
        } catch (error) {
          if (!isTenantBillingError(error)) throw error;
          billingBlocked = true;
          for (const id of capacityCandidateIds) overLimitIds.add(id);
        }
        if (!billingBlocked && printerLimit !== null) {
          const countResult = await tx.execute(sql`
            SELECT COUNT(*)::int AS count
            FROM printers
            WHERE tenant_id = ${agent.tenantId}
              AND lifecycle <> 'retired'
              AND shared_with_gateway = true
              AND (management_source <> 'agent' OR inventory_present = true)
          `);
          const currentPrinterCount = Number(countResult.rows[0]?.count ?? 0);
          const available = Math.max(0, printerLimit - currentPrinterCount);
          for (const id of capacityCandidateIds.slice(available)) overLimitIds.add(id);
        }
      }

      // shortcut: per-printer UPDATE/INSERT loop (pages capped at 500) holds the
      // per-tenant advisory lock for the whole snapshot page; upgrade to a bulk
      // upsert when fleets approach the cap and heartbeat latency grows.
      for (const p of sanitizedPrinters) {
        const existing = inventoryById.get(p.id);
        if (!existing) continue;
        if (existing.agentId !== agent.id) {
          skipped.push({ id: p.id, reason: `owned_by_another_agent (${existing.agentId})` });
          pageHadErrors = true;
          continue;
        }

        const updateSharing = mayUpdateSharing(p, existing);
        const reshareBlocked = existing.sharedWithGateway === false && updateSharing && overLimitIds.has(p.id);
        const reactivationBlocked = existing.sharedWithGateway !== false && existing.managementSource === "agent"
          && existing.lifecycle !== "retired"
          && existing.inventoryPresent === false
          && overLimitIds.has(p.id);
        if (reactivationBlocked || reshareBlocked) {
          skipped.push({ id: p.id, reason: billingBlocked ? "billing_required" : "max_printers_exceeded" });
        }
        if (updateSharing && !reshareBlocked && !reactivationBlocked) positivelySharedIds.push(p.id);

        const observedUpdateSet = {
          ...verificationById.get(p.id),
          status: reactivationBlocked ? "unknown" : p.status,
          observedDeviceClass: p.deviceClass as typeof printers.$inferInsert.observedDeviceClass,
          capabilities: observedCapabilities(p, existing) as typeof printers.$inferInsert.capabilities,
          lastSeenAt: sql`now()`,
          inventoryPresent: reactivationBlocked ? false : true,
          ...(snapshotEnabled ? { inventorySnapshotId } : {}),
          // Omitted legacy fields preserve a prior local denial. A new explicit
          // opt-in must pass capacity without changing remote lifecycle/config.
          ...(updateSharing && !reshareBlocked ? { sharedWithGateway: true, sharedWithGatewayVersion: inventorySnapshotVersion } : {}),
        };
        const updateSet = existing.managementSource === "agent"
          ? {
              ...observedUpdateSet,
              name: p.name,
              printerType: p.printerType as typeof printers.$inferInsert.printerType,
              deviceClass: p.deviceClass as typeof printers.$inferInsert.deviceClass,
              connectionType: p.connectionType as typeof printers.$inferInsert.connectionType,
              protocol: p.protocol as typeof printers.$inferInsert.protocol,
              config: p.config as typeof printers.$inferInsert.config,
              physicalIdentityKey: physicalPrinterIdentityKey(p),
              outputMedium: p.connectionType === "pdf_output" ? "file" : "physical",
            }
          : observedUpdateSet;
        await tx.update(printers)
          .set(updateSet)
          .where(and(
            eq(printers.id, p.id),
            eq(printers.tenantId, agent.tenantId),
            eq(printers.agentId, agent.id),
            eq(printers.managementSource, existing.managementSource),
          ));
      }

      for (const p of sanitizedPrinters) {
        if (inventoryById.has(p.id)) continue;
        if (privatePrinterIds.has(p.id)) continue;
        if (gatewayOwnedPrinterIds.has(p.id)) {
          skipped.push({ id: p.id, reason: "gateway_owned_deletion_pending" });
          pageHadErrors = true;
          continue;
        }
        if (overLimitIds.has(p.id)) {
          skipped.push({ id: p.id, reason: billingBlocked ? "billing_required" : "max_printers_exceeded" });
          continue;
        }

        const inserted = await tx.insert(printers).values({
          id: p.id,
          tenantId: agent.tenantId,
          agentId: agent.id,
          name: p.name,
          printerType: p.printerType as typeof printers.$inferInsert.printerType,
          deviceClass: p.deviceClass as typeof printers.$inferInsert.deviceClass,
          connectionType: p.connectionType as typeof printers.$inferInsert.connectionType,
          protocol: p.protocol as typeof printers.$inferInsert.protocol,
          status: p.status,
          lifecycle: "active",
          managementSource: "agent",
          sharedWithGatewayVersion: p.sharedWithGateway === true ? inventorySnapshotVersion : null,
          desiredRevision: 0,
          appliedDesiredRevision: 0,
          observedDesiredRevision: 0,
          observedDeviceClass: p.deviceClass as typeof printers.$inferInsert.observedDeviceClass,
          config: p.config as typeof printers.$inferInsert.config,
          physicalIdentityKey: physicalPrinterIdentityKey(p),
          ...verificationById.get(p.id),
          outputMedium: p.connectionType === "pdf_output" ? "file" : "physical",
          capabilities: verificationById.get(p.id)?.verificationState === "verified" ? p.capabilities : p.capabilities ? Object.fromEntries(Object.entries(p.capabilities).filter(([key]) => key !== "operational_verification")) : null,
          inventoryPresent: true,
          inventorySnapshotId: snapshotEnabled ? inventorySnapshotId : null,
          lastSeenAt: sql`now()`,
        }).onConflictDoNothing({ target: [printers.tenantId, printers.id] }).returning({ id: printers.id });

        if (inserted.length === 0) {
          const raced = await tx.query.printers.findFirst({
            where: and(eq(printers.id, p.id), eq(printers.tenantId, agent.tenantId)),
          });
          if (raced && raced.agentId === agent.id) {
            await tx.update(printers)
              .set({
                ...verificationById.get(p.id),
                status: p.status,
                observedDeviceClass: p.deviceClass as typeof printers.$inferInsert.observedDeviceClass,
                capabilities: observedCapabilities(p, raced) as typeof printers.$inferInsert.capabilities,
                inventoryPresent: true,
                ...(snapshotEnabled ? { inventorySnapshotId } : {}),
                lastSeenAt: sql`now()`,
              })
              .where(and(eq(printers.id, p.id), eq(printers.tenantId, agent.tenantId), eq(printers.agentId, agent.id)));
          } else {
            skipped.push({ id: p.id, reason: "insert_conflict_owned_by_another_agent" });
            pageHadErrors = true;
          }
        }
      }

      if (positivelySharedIds.length > 0) {
        // Only current explicit permission releases a zero-byte local refusal.
        // Batch the scoped update and use the existing durable notification so
        // connected WS Agents and polling Agents can resume the original jobs.
        // Status, counters, TTL and claim history remain unchanged.
        await tx.execute(sql`
          WITH resumed AS (
            UPDATE print_jobs SET error = NULL
            WHERE tenant_id = ${agent.tenantId} AND agent_id = ${agent.id}
              AND printer_id IN (${sql.join(positivelySharedIds.map((id) => sql`${id}`), sql`, `)})
              AND status = 'queued' AND error = ${PRINTER_NOT_SHARED_PAUSE}
            RETURNING id, agent_id, tenant_id, request_id
          )
          SELECT pg_notify('print_gateway_agent_jobs', json_build_object(
            'jobId', id, 'agentId', agent_id, 'tenantId', tenant_id, 'requestId', request_id
          )::text) FROM resumed
        `);
      }

      // Only a final page from a complete, ordered and error-free snapshot may
      // declare absence. This MUST run after every insert/conflict decision on
      // the page: late ownership/insert conflicts are snapshot errors too and
      // must preserve prior presence rather than deleting healthy inventory.
      const mayReconcileAbsence = snapshotEnabled && inventorySnapshotVersion !== null && isFinalHeartbeatPage && inventoryComplete && !priorSnapshotHadErrors && !pageHadErrors;
      if (mayReconcileAbsence) {
        await tx.execute(sql`
          UPDATE printers
          SET inventory_present = false, status = 'unknown', verification_state = 'pending', verification_verified_at = NULL, verification_received_at = NULL, verification_binding_digest = NULL, verification_reason = 'verification_inventory_absent', updated_at = now()
          WHERE tenant_id = ${agent.tenantId}
            AND agent_id = ${agent.id}
            AND management_source = 'agent'
            AND shared_with_gateway = true
            AND lifecycle <> 'retired'
            AND inventory_present = true
            AND inventory_snapshot_id IS DISTINCT FROM ${inventorySnapshotId}
        `);
      }

      if (snapshotEnabled) {
        const snapshotHadErrors = priorSnapshotHadErrors || pageHadErrors;
        if (isFinalHeartbeatPage) {
          await tx.update(agents).set({
            ...(inventorySnapshotVersion ? { inventorySnapshotVersion } : {}),
            inventorySnapshotId: null,
            inventorySnapshotPageCount: 0,
            inventorySnapshotNextPage: 1,
            inventorySnapshotComplete: false,
            inventorySnapshotHadErrors: false,
          }).where(and(eq(agents.id, agent.id), eq(agents.tenantId, agent.tenantId)));
        } else {
          await tx.update(agents).set({
            ...(inventorySnapshotVersion ? { inventorySnapshotVersion } : {}),
            inventorySnapshotId,
            inventorySnapshotPageCount: heartbeatPageCount,
            inventorySnapshotNextPage: heartbeatPage + 1,
            inventorySnapshotComplete: inventoryComplete,
            inventorySnapshotHadErrors: snapshotHadErrors,
          }).where(and(eq(agents.id, agent.id), eq(agents.tenantId, agent.tenantId)));
        }
      }

      const desiredPage = isFinalHeartbeatPage
        ? await getDesiredPrinterPage(agent.tenantId, agent.id, undefined, options => tx.query.printers.findMany(options))
        : null;

      return {
        kind: "ok" as const,
        skippedPrinters: skipped,
        printerIdAliases,
        billingBlocked,
        desiredState: desiredPage && (desiredStatePaging || desiredPage.nextCursor === null) ? desiredPage.items : null,
        desiredStateNextCursor: desiredStatePaging ? desiredPage?.nextCursor ?? null : null,
        desiredStateUpgradeRequired: desiredPage !== null && !desiredStatePaging && desiredPage.nextCursor !== null,
        isFinalPage: isFinalHeartbeatPage,
      };
    });

    if (result.kind === "missing") return NextResponse.json({ error: "Agent not found" }, { status: 401 });
    if (result.kind === "inactive") return NextResponse.json({ error: `Agent is ${result.lifecycle}` }, { status: 409 });
    if (result.kind === "inventory_conflict") return NextResponse.json({
      error: "Inventory snapshot page is out of order or no longer current",
      code: "INVENTORY_SNAPSHOT_CONFLICT",
      expectedPage: result.expectedPage,
      minimumSnapshotVersion: result.minimumSnapshotVersion,
    }, { status: 409, headers: { "Cache-Control": "no-store" } });

    const response: Record<string, unknown> = {
      success: true,
      skippedPrinters: result.skippedPrinters,
    };
    if (result.billingBlocked) {
      response.billingBlocked = true;
      logWarn("agent.heartbeat.billing_blocked", { agentId: agent.id, tenantId: agent.tenantId });
    }
    if (Object.keys(result.printerIdAliases).length > 0) {
      response.printerIdAliases = result.printerIdAliases;
    }
    if (result.isFinalPage) {
      if (result.desiredState !== null) response.desiredState = result.desiredState.map((row) => ({
        id: row.id,
        name: row.name,
        printerType: row.printerType,
        deviceClass: row.deviceClass,
        connectionType: row.connectionType,
        protocol: row.protocol,
        lifecycle: row.lifecycle,
        config: row.config,
        desiredRevision: row.desiredRevision,
      }));
      if (result.desiredStateNextCursor !== null) response.desiredStateNextCursor = result.desiredStateNextCursor;
      if (result.desiredStateUpgradeRequired) {
        response.desiredStateUpgradeRequired = true;
        logWarn("agent.heartbeat.desired_state_upgrade_required", { agentId: agent.id, tenantId: agent.tenantId });
      }
    }
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof TenantEntitlementError) {
      return NextResponse.json({
        error: error.message,
        code: "MAX_PRINTERS_EXCEEDED",
        entitlement: error.entitlement,
        limit: error.limit,
        used: error.used,
        upgradeRequired: true,
      }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
    }
    if (isTenantBillingError(error)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
    }
    logError("agent.heartbeat.failed", { agentId: agent.id, error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
