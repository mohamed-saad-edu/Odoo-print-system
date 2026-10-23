import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DbTx } from "../db";
import type { V2OdooIdentity } from "./odoo-idempotency";

export class OdooNamespaceError extends Error {
  constructor(public readonly code: string, public readonly status = 409) {
    super(code);
  }
}

type IdentityRow = {
  id: string;
  printer_id: string;
  agent_id: string;
  status: string;
  fingerprint: string;
};

type LiveRow = {
  id: string;
  printer_id: string;
  agent_id: string;
  status: string;
  printer_idempotency_key?: string;
  payload: unknown;
  destination: string | null;
  document_type: string | null;
};

type Digest = (input: {printerId: string; destination: string | null; documentType: string | null; payload: unknown}) => string;

/** Registration proof never enters job tables, job responses or audit metadata. */
export async function verifyOdooInstallation(
  tx: Pick<DbTx,"execute">,
  tenantId: string,
  apiKeyId: string,
  identity: Pick<V2OdooIdentity, "installationId" | "installationProof">,
): Promise<void> {
  const rows = await tx.execute(sql`
    SELECT i.secret_hash FROM odoo_installations i
    JOIN odoo_installation_credentials c
      ON c.tenant_id = i.tenant_id AND c.installation_id = i.id
    WHERE i.id = ${identity.installationId} AND i.tenant_id = ${tenantId}
      AND i.enabled = TRUE AND c.api_key_id = ${apiKeyId}
    FOR SHARE OF i, c
  `);
  const stored = (rows.rows[0] as { secret_hash?: string } | undefined)?.secret_hash;
  const inputHash = createHash("sha256").update(identity.installationProof).digest();
  // Constant work when the installation is missing as well; no information
  // about the installed proof must be reflected in the failure response.
  const expected = /^[0-9a-f]{64}$/.test(stored ?? "")
    ? Buffer.from(stored!, "hex") : Buffer.alloc(inputHash.length);
  if (!stored || !timingSafeEqual(inputHash, expected)) {
    throw new OdooNamespaceError("INSTALLATION_NOT_ENROLLED", 403);
  }
}

async function historicalByKey(
  tx: Pick<DbTx,"execute">,
  tenantId: string,
  key: string,
  digest: Digest,
): Promise<IdentityRow | null> {
  const receipt = await tx.execute(sql`
    SELECT id, printer_id, agent_id, status, fingerprint
    FROM print_job_receipts WHERE tenant_id = ${tenantId} AND idempotency_key = ${key}
    FOR SHARE
  `);
  if (receipt.rows[0]) return receipt.rows[0] as IdentityRow;
  const live = await tx.execute(sql`
    SELECT id, printer_id, agent_id, status, payload, destination, document_type
    FROM print_jobs WHERE tenant_id = ${tenantId} AND idempotency_key = ${key}
    FOR SHARE
  `);
  if (!live.rows[0]) return null;
  const row = live.rows[0] as LiveRow;
  return { id: row.id, printer_id: row.printer_id, agent_id: row.agent_id, status: row.status,
    fingerprint: digest({ printerId: row.printer_id, destination: row.destination, documentType: row.document_type, payload: row.payload }) };
}

async function historicalById(tx: Pick<DbTx,"execute">, tenantId: string, id: string, digest: Digest): Promise<IdentityRow | null> {
  const receipt = await tx.execute(sql`
    SELECT id, printer_id, agent_id, status, fingerprint
    FROM print_job_receipts WHERE tenant_id = ${tenantId} AND id = ${id} FOR SHARE
  `);
  if (receipt.rows[0]) return receipt.rows[0] as IdentityRow;
  const live = await tx.execute(sql`
    SELECT id, printer_id, agent_id, status, payload, destination, document_type
    FROM print_jobs WHERE tenant_id = ${tenantId} AND id = ${id} FOR SHARE
  `);
  if (!live.rows[0]) return null;
  const row = live.rows[0] as LiveRow;
  return { id: row.id, printer_id: row.printer_id, agent_id: row.agent_id, status: row.status,
    fingerprint: digest({ printerId: row.printer_id, destination: row.destination, documentType: row.document_type, payload: row.payload }) };
}

export type S06Reuse = {
  jobId: string;
  printerId: string;
  agentId: string;
  status: string;
  isReused: true;
};

/**
 * Called INSIDE print admission transaction AFTER tenant / Agent / API key
 * fences. All matching legacy live rows and lifetime receipts are considered;
 * content similarity never establishes installation ownership. An operator
 * must make and audit any reuse-vs-distinct decision.
 */
export async function reserveV2Operation(
  tx: Pick<DbTx,"execute">,
  args: {
    tenantId: string;
    apiKeyId: string;
    identity: V2OdooIdentity;
    requestedFingerprint: string;
    digest: Digest;
    newJobId: string | null;
  },
): Promise<S06Reuse | null> {
  const { tenantId, identity, apiKeyId } = args;
  await verifyOdooInstallation(tx, tenantId, apiKeyId, identity);
  const existing = await tx.execute(sql`
    SELECT installation_id, source_company_id, source_operation_id, legacy_key, accepted_job_id
    FROM odoo_v2_operations WHERE tenant_id = ${tenantId} AND idempotency_key = ${identity.key} FOR UPDATE
  `);
  if (existing.rows.length) {
    const row = existing.rows[0] as { installation_id: string; source_company_id: string; source_operation_id: string; legacy_key: string; accepted_job_id: string };
    if (row.installation_id !== identity.installationId || row.source_company_id !== identity.sourceCompanyId ||
        row.source_operation_id !== identity.sourceOperationId || row.legacy_key !== identity.legacyKey) {
      throw new OdooNamespaceError("IDEMPOTENCY_CONFLICT");
    }
    const found = await historicalById(tx, tenantId, row.accepted_job_id, args.digest);
    if (!found || found.fingerprint !== args.requestedFingerprint) throw new OdooNamespaceError("RECONCILIATION_REQUIRED");
    return { jobId: found.id, printerId: found.printer_id, agentId: found.agent_id,
      status: found.status, isReused: true };
  }

  const legacy = await historicalByKey(tx, tenantId, identity.legacyKey, args.digest);
  const resolution = await tx.execute(sql`
    SELECT installation_id, legacy_key, disposition, legacy_job_id, legacy_fingerprint
    FROM odoo_legacy_resolutions WHERE tenant_id = ${tenantId} AND idempotency_key = ${identity.key} FOR SHARE
  `);
  const alias = resolution.rows[0] as {
    installation_id: string; legacy_key: string; disposition: "reuse" | "distinct";
    legacy_job_id: string; legacy_fingerprint: string;
  } | undefined;

  if (legacy) {
    if (!alias || alias.installation_id !== identity.installationId || alias.legacy_key !== identity.legacyKey ||
        alias.legacy_job_id !== legacy.id || alias.legacy_fingerprint !== legacy.fingerprint) {
      throw new OdooNamespaceError("RECONCILIATION_REQUIRED");
    }
    if (alias.disposition === "reuse") {
      if (legacy.fingerprint !== args.requestedFingerprint) throw new OdooNamespaceError("IDEMPOTENCY_CONFLICT");
      await tx.execute(sql`
        INSERT INTO odoo_v2_operations (tenant_id, installation_id, idempotency_key, legacy_key,
          source_company_id, source_operation_id, accepted_job_id)
        VALUES (${tenantId}, ${identity.installationId}, ${identity.key}, ${identity.legacyKey},
          ${identity.sourceCompanyId}, ${identity.sourceOperationId}, ${legacy.id})
      `);
      return { jobId: legacy.id, printerId: legacy.printer_id, agentId: legacy.agent_id,
        status: legacy.status, isReused: true };
    }
    if (alias.disposition !== "distinct") throw new OdooNamespaceError("RECONCILIATION_REQUIRED");
  } else if (alias) {
    // Disappeared legacy history must not silently turn a previously approved
    // replay into fresh physical output.
    throw new OdooNamespaceError("RECONCILIATION_REQUIRED");
  }

  if (!args.newJobId) return null; // Missing owner: caller reports 404, never reserves an unprintable job.
  await tx.execute(sql`
    INSERT INTO odoo_v2_operations (tenant_id, installation_id, idempotency_key, legacy_key,
      source_company_id, source_operation_id, accepted_job_id)
    VALUES (${tenantId}, ${identity.installationId}, ${identity.key}, ${identity.legacyKey},
      ${identity.sourceCompanyId}, ${identity.sourceOperationId}, ${args.newJobId})
  `);
  return null;
}
