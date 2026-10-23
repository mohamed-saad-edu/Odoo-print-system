import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../../../db";
import { validateWorkspaceManager } from "../../../../../lib/manager-auth";
import { requireManagerPermission } from "../../../../../lib/authorization";
import { requireManagerActorInTransaction } from "../../../../../lib/manager-mutation-authorization";
import { requireActiveTenantInTransaction } from "../../../../../lib/tenant-guard";
import { writeAuditEvent } from "../../../../../lib/audit";
import { idempotencyDigest } from "../../../../../lib/print-job-service";
import { makeLegacyOdooKey, makeV2OdooKey } from "../../../../../lib/odoo-idempotency";
import { logError } from "../../../../../lib/log";

export const dynamic = "force-dynamic";
const operationSchema = z.object({
  installationId: z.string().uuid(),
  sourceCompanyId: z.string().regex(/^[1-9][0-9]{0,17}$/),
  sourceOperationId: z.string().min(1).max(200),
}).strict();
const approveSchema = operationSchema.extend({
  disposition: z.enum(["reuse", "distinct"]),
  expectedLegacyJobId: z.string().trim().min(1).max(128),
  expectedLegacyFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  // A separate human reconciliation decision is required, not a similarity
  // heuristic based on matching bytes, Odoo company ID or a copied DB name.
  operatorAttestation: z.literal("HISTORY_AND_PHYSICAL_OUTCOME_REVIEWED"),
});

type LegacyCandidate = { id: string; fingerprint: string; status: string };

async function findLegacyHistory(tx: Pick<typeof db, "execute">, tenantId: string, legacyKey: string): Promise<LegacyCandidate | null> {
  const receipt = await tx.execute(sql`
    SELECT id, fingerprint, status FROM print_job_receipts
    WHERE tenant_id = ${tenantId} AND idempotency_key = ${legacyKey}
      AND api_key_id IS NOT NULL
    FOR UPDATE
  `);
  if (receipt.rows[0]) return receipt.rows[0] as LegacyCandidate;
  const live = await tx.execute(sql`
    SELECT id, printer_id, destination, document_type, payload, status FROM print_jobs
    WHERE tenant_id = ${tenantId} AND idempotency_key = ${legacyKey}
      AND api_key_id IS NOT NULL
    FOR UPDATE
  `);
  if (!live.rows[0]) return null;
  const row = live.rows[0] as {id: string; printer_id: string; destination: string | null; document_type: string | null; payload: unknown; status: string};
  return { id: row.id, status: row.status, fingerprint: idempotencyDigest({
    printerId: row.printer_id, destination: row.destination, documentType: row.document_type, payload: row.payload,
  }) };
}

async function authorizedManager(req: Request, manage: boolean) {
  const manager = await validateWorkspaceManager(req);
  if (!manager) return null;
  try { requireManagerPermission(manager, manage ? "integrations.manage" : "integrations.read"); }
  catch { return null; }
  return manager;
}

export async function GET(req: Request) {
  const manager = await authorizedManager(req, false);
  if (!manager) return NextResponse.json({ error: "Unauthorized or forbidden" }, { status: 403 });
  const parsed = operationSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid source operation identity" }, { status: 400 });
  const { installationId, sourceCompanyId, sourceOperationId } = parsed.data;
  const legacyKey = makeLegacyOdooKey(sourceCompanyId, sourceOperationId);
  const v2Key = makeV2OdooKey(installationId, sourceCompanyId, sourceOperationId);
  const rows = await db.execute(sql`
    SELECT id FROM odoo_installations
    WHERE id = ${installationId} AND tenant_id = ${manager.tenantId} AND enabled = TRUE
  `);
  if (!rows.rows.length) return NextResponse.json({ error: "Installation not registered" }, { status: 404 });
  const candidate = await findLegacyHistory(db, manager.tenantId, legacyKey);
  const decision = await db.execute(sql`
    SELECT disposition, legacy_job_id, legacy_fingerprint, approved_at
    FROM odoo_legacy_resolutions WHERE tenant_id = ${manager.tenantId}
      AND installation_id = ${installationId} AND idempotency_key = ${v2Key}
  `);
  return NextResponse.json({
    installationId, v2Key, legacyKey, history: candidate,
    resolution: decision.rows[0] ?? null,
    warning: "A matching fingerprint is not proof of installation ownership. Review the original business intent and physical outcome.",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const manager = await authorizedManager(req, true);
  if (!manager) return NextResponse.json({ error: "Unauthorized or forbidden" }, { status: 403 });
  const parsed = approveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Explicit, verified legacy receipt resolution required" }, { status: 400 });
  const { installationId, sourceCompanyId, sourceOperationId, disposition, expectedLegacyJobId, expectedLegacyFingerprint } = parsed.data;
  const legacyKey = makeLegacyOdooKey(sourceCompanyId, sourceOperationId);
  const v2Key = makeV2OdooKey(installationId, sourceCompanyId, sourceOperationId);
  try {
    const result = await db.transaction(async (tx) => {
      await requireActiveTenantInTransaction(tx, manager.tenantId);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`print_jobs:tenant:${manager.tenantId}`}))`);
      await requireManagerActorInTransaction(tx, manager, "integrations.manage");
      const enrolled = await tx.execute(sql`
        SELECT id FROM odoo_installations
        WHERE id = ${installationId} AND tenant_id = ${manager.tenantId} AND enabled = TRUE FOR UPDATE
      `);
      if (!enrolled.rows.length) return "not_enrolled";
      const reserved = await tx.execute(sql`
        SELECT accepted_job_id FROM odoo_v2_operations
        WHERE tenant_id = ${manager.tenantId} AND idempotency_key = ${v2Key} FOR UPDATE
      `);
      if (reserved.rows.length) return "already_accepted";
      const found = await findLegacyHistory(tx, manager.tenantId, legacyKey);
      if (!found || found.id !== expectedLegacyJobId || found.fingerprint !== expectedLegacyFingerprint) return "history_mismatch";
      const existing = await tx.execute(sql`
        SELECT disposition, legacy_job_id, legacy_fingerprint FROM odoo_legacy_resolutions
        WHERE tenant_id = ${manager.tenantId} AND idempotency_key = ${v2Key} FOR UPDATE
      `);
      if (existing.rows.length) {
        const row = existing.rows[0] as { disposition: string; legacy_job_id: string; legacy_fingerprint: string };
        return row.disposition === disposition && row.legacy_job_id === found.id && row.legacy_fingerprint === found.fingerprint
          ? "already_resolved" : "conflicting_resolution";
      }
      await tx.execute(sql`
        INSERT INTO odoo_legacy_resolutions
          (tenant_id, installation_id, idempotency_key, legacy_key, disposition,
           legacy_job_id, legacy_fingerprint, approved_by)
        VALUES (${manager.tenantId}, ${installationId}, ${v2Key}, ${legacyKey},
                ${disposition}, ${found.id}, ${found.fingerprint},
                ${manager.userId ?? "legacy-manager"})
      `);
      if (disposition === "reuse") {
        // Immediately publish the immutable historical mapping. GET can now
        // recover the original receipt even if the Odoo POST response was
        // lost; this does not enqueue a new print or reserve quota.
        await tx.execute(sql`
          INSERT INTO odoo_v2_operations (tenant_id, installation_id, idempotency_key,
            legacy_key, source_company_id, source_operation_id, accepted_job_id)
          VALUES (${manager.tenantId}, ${installationId}, ${v2Key}, ${legacyKey},
            ${sourceCompanyId}, ${sourceOperationId}, ${found.id})
        `);
      }
      await writeAuditEvent({ tenantId: manager.tenantId, actorType: manager.userId ? "user" : "system",
        actorId: manager.userId ?? "legacy-manager", action: "odoo.legacy_intent.manually_resolved",
        resourceType: "odoo_installation", resourceId: installationId,
        metadata: { v2Key, legacyKey, legacyJobId: found.id, disposition,
          humanReviewedPhysicalOutcome: true } }, tx);
      return "resolved";
    });
    if (result === "resolved" || result === "already_resolved") return NextResponse.json({ status: result, disposition, v2Key, legacyKey });
    return NextResponse.json({ error: "Legacy disposition cannot be applied", code: String(result).toUpperCase() }, { status: 409 });
  } catch (error) {
    logError("odoo.legacy_resolution_failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Resolution unavailable" }, { status: 500 });
  }
}
