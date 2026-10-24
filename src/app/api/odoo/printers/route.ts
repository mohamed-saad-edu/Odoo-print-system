import { printerOperationalVerificationPredicate } from "../../../../lib/printer-verification-sql";
import { operationalVerificationPresentation, type OperationalPrinterState } from "../../../../lib/printer-operational-verification";
import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { agents, printers } from "../../../../db/schema";
import { validateOdooKey } from "../../../../lib/odoo-auth";
import { getAgentHeartbeatFreshness, getEffectivePrinterStatus, getPrinterObservationFreshness } from "../../../../lib/agent-availability";
import { gatewayNow, refreshClockSkew } from "../../../../lib/database-clock";
import { receiptPaperWidthMM, receiptRasterWidthDots } from "../../../../lib/receipt-width";
import { TenantSubscriptionRequiredError, requireTenantBillingAccess } from "../../../../lib/entitlements";
import { isVirtualPrinterRecord } from "../../../../lib/printer-virtual";
import { getSupportedDocumentTypes, type ProtocolType, type TransportType } from "../../../../lib/printer-capability";
import { capabilitiesWithCurrentGeometry, printerGeometryFromCapabilities } from "../../../../lib/printer-geometry";

export const dynamic = "force-dynamic";

/** Publish only document languages admitted by the Gateway's physical transport
 * validator. A TCP byte stream labelled "spooler" must not look like a
 * Windows driver, regardless of legacy supported_protocols metadata.
 * Keep raw capability JSON untrusted: malformed lists fail closed in the
 * shared validator rather than being interpreted as missing metadata.
 */
function odooPrinterCapabilities(value: unknown, connectionType: string, protocol: string, config?: Record<string, unknown> | null) {
  const reported = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const geometry = printerGeometryFromCapabilities(reported);
  const paperWidth = receiptPaperWidthMM(reported) ?? receiptPaperWidthMM(config);
  return {
    supported_protocols: getSupportedDocumentTypes(
      protocol.trim().toLowerCase() as ProtocolType,
      connectionType.trim().toLowerCase() as TransportType,
      reported,
    ),
    ...(paperWidth ? { paper_width_mm: paperWidth } : {}),
    ...(geometry ? { geometry } : {}),
    ...(reported?.operational_verification ? { operational_verification: reported.operational_verification } : {}),
  };
}

export async function GET(req: Request) {
  const apiKey = await validateOdooKey(req, { requireIntegrationEnabled: false });
  if (!apiKey) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Printer inventory is an Odoo runtime-control-plane surface. Do not expose
  // tenant printer identities after subscription access has ended; use the same
  // database-authoritative predicate as print admission and agent discovery.
  //
  // The billing decision and the inventory read run in ONE transaction, so a
  // subscription that lapses between them cannot still expose tenant printer
  // identities. The subscription row lock the check takes is held until the
  // read completes.
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get("agent_id")?.trim();

  const conditions = [printerOperationalVerificationPredicate(sql`printers`), eq(printers.lifecycle, "active"), eq(printers.inventoryPresent, true), eq(printers.sharedWithGateway, true), eq(agents.lifecycle, "active"), eq(printers.tenantId, apiKey.tenantId), eq(agents.tenantId, apiKey.tenantId)];
  if (agentId) {
    conditions.push(eq(agents.id, agentId));
  }

  await refreshClockSkew();
  const now = gatewayNow();
  let rows: Array<OperationalPrinterState & {
    id: string;
    name: string;
    status: string | null;
    lifecycle: string;
    sharedWithGateway: boolean;
    lastSeenAt: Date | null;
    printerType: string | null;
    deviceClass: string | null;
    connectionType: string | null;
    protocol: string | null;
    capabilities: Record<string, unknown> | null;
    config: Record<string, unknown> | null;
    managementSource: string | null;
    desiredRevision: number;
    appliedDesiredRevision: number;
    observedDesiredRevision: number;
    agentId: string;
    agentName: string;
    agentStatus: string | null;
    agentLifecycle: string;
    agentLastSeenAt: Date | null;
  }>;
  try {
    rows = await db.transaction(async (tx) => {
      await requireTenantBillingAccess(tx, apiKey.tenantId);
      return tx
        .select({
          verificationState: printers.verificationState,
          verificationVerifiedAt: printers.verificationVerifiedAt,
          verificationReceivedAt: printers.verificationReceivedAt,
          verificationBindingDigest: printers.verificationBindingDigest,
          verificationReason: printers.verificationReason,
          logicalQueueKey: printers.logicalQueueKey,
          physicalDeviceKey: printers.physicalDeviceKey,
          outputMedium: printers.outputMedium,
          id: printers.id,
          name: printers.name,
          status: printers.status,
          lifecycle: printers.lifecycle,
          sharedWithGateway: printers.sharedWithGateway,
          lastSeenAt: printers.lastSeenAt,
          printerType: printers.printerType,
          deviceClass: printers.deviceClass,
          connectionType: printers.connectionType,
          protocol: printers.protocol,
          capabilities: printers.capabilities,
          config: printers.config,
          managementSource: printers.managementSource,
          desiredRevision: printers.desiredRevision,
          appliedDesiredRevision: printers.appliedDesiredRevision,
          observedDesiredRevision: printers.observedDesiredRevision,
          agentId: agents.id,
          agentName: agents.name,
          agentStatus: agents.status,
          agentLifecycle: agents.lifecycle,
          agentLastSeenAt: agents.lastSeenAt,
        })
        .from(printers)
        .innerJoin(agents, and(eq(printers.agentId, agents.id), eq(printers.tenantId, agents.tenantId)))
        .where(and(...conditions))
        .orderBy(printers.name);
    });
  } catch (error) {
    if (error instanceof TenantSubscriptionRequiredError) {
      return NextResponse.json(
        { error: error.message, code: "SUBSCRIPTION_REQUIRED" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
  return NextResponse.json({
    printers: rows.filter((row) => !isVirtualPrinterRecord(row)).map((row) => ({
      ...operationalVerificationPresentation(row, now),
      id: row.id,
      name: row.name,
      reportedStatus: row.status,
      freshness: getPrinterObservationFreshness(row.lastSeenAt, now),
      lastSeenAt: row.lastSeenAt,
      status: getEffectivePrinterStatus(
        { lifecycle: row.lifecycle, status: row.status, lastSeenAt: row.lastSeenAt },
        { lifecycle: row.agentLifecycle, status: row.agentStatus, lastSeenAt: row.agentLastSeenAt },
        now,
      ),
      lifecycle: row.lifecycle,
      sharedWithGateway: row.sharedWithGateway,
      printerType: row.printerType,
      deviceClass: row.deviceClass,
      connectionType: row.connectionType,
      protocol: row.protocol,
      capabilities: odooPrinterCapabilities(capabilitiesWithCurrentGeometry(row), row.connectionType ?? "", row.protocol ?? "", row.config),
      printableWidthDots: receiptRasterWidthDots(capabilitiesWithCurrentGeometry(row)),
      agent: {
        id: row.agentId,
        name: row.agentName,
        reportedStatus: row.agentStatus,
        freshness: getAgentHeartbeatFreshness(row.agentLastSeenAt, now),
        lastSeenAt: row.agentLastSeenAt,
      },
    })),
  }, { status: 200, headers: { "Cache-Control": "no-store" } });
}
