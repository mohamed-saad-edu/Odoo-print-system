import { and, eq, isNotNull, sql, type SQLWrapper } from "drizzle-orm";
import { db, type DbTx } from "../db";
import { printJobs, printJobReceipts, tenants } from "../db/schema";
import { OdooNamespaceError, verifyOdooInstallation } from "./odoo-v2-admission";

export type OdooStatusIdentity = { installationId: string; installationProof: string };
type OdooStatusCredential = { id: string; tenantId: string; hashedKey: string };

/**
 * Hold read authority until all metadata has been read. A completed revoke,
 * suspension or cutover must be observed; otherwise that mutation waits for
 * this authorized read to finish. Keep tenant -> credential -> installation
 * lock order consistent with admission and credential management.
 */
export async function requireOdooStatusAccess(
  tx: Pick<DbTx, "execute">,
  key: OdooStatusCredential,
  identity: OdooStatusIdentity | null,
): Promise<void> {
  const tenant = await tx.execute(sql`
    SELECT lifecycle, odoo_idempotency_mode AS mode
    FROM tenants WHERE id = ${key.tenantId} FOR SHARE
  `);
  const policy = tenant.rows[0] as { lifecycle?: string; mode?: string } | undefined;
  if (policy?.lifecycle !== "active") throw new OdooNamespaceError("WORKSPACE_UNAVAILABLE", 403);
  if (!identity && policy.mode !== "legacy") throw new OdooNamespaceError("INSTALLATION_NOT_ENROLLED", 403);

  // Status reconciliation intentionally accepts the existing rotation grace.
  // Evaluate its expiry on the database clock, not a stale authentication row.
  const credential = await tx.execute(sql`
    SELECT id FROM api_keys
    WHERE id = ${key.id} AND tenant_id = ${key.tenantId}
      AND hashed_key = ${key.hashedKey} AND odoo_enabled = TRUE
      AND ((revoked_at IS NULL AND read_only_until IS NULL)
        OR (revoked_at IS NOT NULL AND revoked_at <= clock_timestamp()
          AND read_only_until IS NOT NULL AND read_only_until > clock_timestamp()))
    FOR SHARE
  `);
  if (credential.rows.length !== 1) throw new OdooNamespaceError("UNAUTHORIZED", 401);
  if (identity) await verifyOdooInstallation(tx, key.tenantId, key.id, identity);
}

/**
 * Read authority comes from the workspace policy, not from a caller choosing
 * to omit v2 headers. Historical v1 reads are allowed only before cutover.
 */
export async function odooStatusIdentity(req: Request, tenantId: string): Promise<OdooStatusIdentity | null> {
  const version = req.headers.get("x-yaseir-odoo-idempotency-version");
  const installationId = req.headers.get("x-yaseir-odoo-installation") ?? "";
  const installationProof = req.headers.get("x-yaseir-odoo-proof") ?? "";
  if (version !== null && version !== "2") throw new OdooNamespaceError("UNSUPPORTED_NAMESPACE_VERSION", 400);
  if (version === "2") {
    if (!installationId || !installationProof || installationId.length > 128 || installationProof.length > 512) {
      throw new OdooNamespaceError("INSTALLATION_NOT_ENROLLED", 403);
    }
    return { installationId, installationProof };
  }
  if (installationId || installationProof) throw new OdooNamespaceError("INVALID_NAMESPACE_HEADERS", 400);
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId), columns: { odooIdempotencyMode: true },
  });
  if (tenant?.odooIdempotencyMode !== "legacy") throw new OdooNamespaceError("INSTALLATION_NOT_ENROLLED", 403);
  return null;
}

/** A legacy read must never downgrade authority over a job already owned by v2. */
export function odooStatusJobScope(jobId: SQLWrapper, tenantId: string, identity: OdooStatusIdentity | null) {
  const owned = sql`EXISTS (
    SELECT 1 FROM odoo_v2_operations status_operation
    WHERE ${and(
      sql`status_operation.tenant_id = ${tenantId}`,
      sql`status_operation.accepted_job_id = ${jobId}`,
      identity ? sql`status_operation.installation_id = ${identity.installationId}` : undefined,
    )}
  )`;
  return identity ? owned : sql`NOT ${owned}`;
}

// Polling metadata must not materialize document payloads, especially for a
// batch of 100 jobs. Keep the projection shared by live rows and receipts.
export const odooStatusColumns = {
  outputMedium: true,
  outputEvidence: true,
  id: true, status: true, printerId: true, agentId: true, destination: true,
  documentType: true, error: true, deliveredAt: true, ackedAt: true, updatedAt: true,
} as const;

/** Shared by both public status URLs so neither can lose a revocation fence. */
export async function readOdooJobStatus(
  key: OdooStatusCredential,
  identity: OdooStatusIdentity | null,
  lookup: { id: string; idempotencyKey?: never } | { id?: never; idempotencyKey: string },
) {
  return db.transaction(async (tx) => {
    await requireOdooStatusAccess(tx, key, identity);
    let resolvedJobId: string | null = null;
    if (identity) {
      const mapped = await tx.execute(sql`
        SELECT accepted_job_id FROM odoo_v2_operations
        WHERE tenant_id = ${key.tenantId} AND installation_id = ${identity.installationId}
          AND ${lookup.id ? sql`accepted_job_id = ${lookup.id}` : sql`idempotency_key = ${lookup.idempotencyKey}`}
        LIMIT 1
      `);
      resolvedJobId = (mapped.rows[0] as { accepted_job_id?: string } | undefined)?.accepted_job_id ?? null;
      if (!resolvedJobId) return null;
    }
    // Provenance survives credential rotation; membership in the proven
    // installation, not equality to the historical API key, controls access.
    const id = resolvedJobId ?? lookup.id;
    const row = await tx.query.printJobs.findFirst({
      columns: odooStatusColumns,
      where: and(
        id ? eq(printJobs.id, id) : eq(printJobs.idempotencyKey, lookup.idempotencyKey!),
        eq(printJobs.tenantId, key.tenantId), isNotNull(printJobs.apiKeyId),
        odooStatusJobScope(printJobs.id, key.tenantId, identity),
      ),
    });
    if (row) return row;
    return await tx.query.printJobReceipts.findFirst({
      columns: odooStatusColumns,
      where: and(
        id ? eq(printJobReceipts.id, id) : eq(printJobReceipts.idempotencyKey, lookup.idempotencyKey!),
        eq(printJobReceipts.tenantId, key.tenantId), isNotNull(printJobReceipts.apiKeyId),
        odooStatusJobScope(printJobReceipts.id, key.tenantId, identity),
      ),
    }) ?? null;
  });
}
