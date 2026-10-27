import { db } from "../db";
import { sql, type SQL } from "drizzle-orm";
import { printOutputPresentation } from "./print-output";
import { isJobFilterStatus, PHYSICAL_OUTCOME_UNKNOWN_MARKERS } from "./job-status";

/**
 * The live queue is intentionally transient. Terminal rows are moved to the
 * payload-free print_job_receipts table during retention cleanup. This bounded
 * read model is shared by workspace and platform dashboards so cleanup does
 * not make successfully submitted jobs disappear from history.
 *
 * No payloads, claim credentials, idempotency fingerprints, or API keys are
 * projected. SQL parameters fence tenants on BOTH sides of the UNION.
 */
export type JobHistoryOptions = {
  tenantId?: string;
  agentId?: string;
  printerId?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

type HistoryRow = {
  id: string;
  tenantId: string;
  tenantName: string | null;
  agentId: string;
  agentName: string | null;
  printerId: string;
  printerName: string | null;
  destination: string | null;
  documentType: string | null;
  requestedBy: string | null;
  status: string;
  error: string | null;
  retries: number | null;
  deliveryAttempts: number | null;
  claimedAt: Date | null;
  deliveredAt: Date | null;
  ackedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  archived: boolean;
  outputMedium: string;
  outputEvidence: Record<string, unknown> | null;
};

function scopedWhere(alias: "j" | "r", tenantId: string | undefined): SQL {
  // Raw alias tokens are compile-time literals, never interpolated user input.
  return tenantId
    ? alias === "j" ? sql`WHERE j.tenant_id = ${tenantId}` : sql`WHERE r.tenant_id = ${tenantId}`
    : sql`WHERE TRUE`;
}

export async function listPrintJobHistory(input: JobHistoryOptions = {}) {
  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 201 || !Number.isSafeInteger(offset) || offset < 0 || offset > 10_000) {
    throw new Error("Invalid history pagination");
  }
  const status = (input.status ?? "all").trim().toLowerCase();
  if (!isJobFilterStatus(status)) throw new Error("Invalid job status");
  const search = input.search?.trim().toLowerCase() ?? "";
  if (search && (search.length < 2 || search.length > 64)) throw new Error("Invalid job search");
  if ((input.agentId?.length ?? 0) > 2048 || (input.printerId?.length ?? 0) > 2048 || (input.tenantId?.length ?? 0) > 2048) {
    throw new Error("Invalid history filter ID");
  }

  const predicates: SQL[] = [];
  if (input.agentId) predicates.push(sql`h.agent_id = ${input.agentId}`);
  if (input.printerId) predicates.push(sql`h.printer_id = ${input.printerId}`);
  if (status === "active" || status === "in_flight") predicates.push(sql`h.status IN ('queued','claimed','printing')`);
  else if (status === "success") predicates.push(sql`h.status = 'success'`);
  else if (status === "queued" || status === "claimed" || status === "printing" || status === "expired") predicates.push(sql`h.status = ${status}`);
  else if (status === "failed" || status === "unknown" || status === "attention") {
    // Marker tokens contain '_' characters; LIKE treats them as wildcards.
    // Exact prefix equality must match derivePhysicalOutcome()'s startsWith().
    const unknown = sql`(${sql.join(PHYSICAL_OUTCOME_UNKNOWN_MARKERS.map(marker => sql`LEFT(COALESCE(h.error, ''), ${marker.length}) = ${marker}`), sql` OR `)})`;
    if (status === "failed") predicates.push(sql`h.status = 'failed' AND NOT ${unknown}`);
    else predicates.push(unknown);
  } else if (status === "unassigned") {
    predicates.push(sql`(
      h.destination = 'unassigned' OR h.printer_id = 'unassigned'
      OR NOT EXISTS (SELECT 1 FROM printers p0 WHERE p0.id = h.printer_id AND p0.tenant_id = h.tenant_id AND p0.lifecycle = 'active')
      OR NOT EXISTS (SELECT 1 FROM agents a0 WHERE a0.id = h.agent_id AND a0.tenant_id = h.tenant_id AND a0.lifecycle = 'active')
    )`);
  }
  if (search) {
    // Literal wildcard search, with the same protection as the enqueue list:
    // .replace(/%/g, "\\%").replace(/_/g, "\\_") and SQL ESCAPE '\\'.
    const escaped = search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    const term = `%${escaped}%`;
    predicates.push(sql`(
      LOWER(h.id) LIKE ${term} ESCAPE '\\'
      OR LOWER(COALESCE(h.destination,'')) LIKE ${term} ESCAPE '\\'
      OR LOWER(COALESCE(h.document_type,'')) LIKE ${term} ESCAPE '\\'
      OR LOWER(h.printer_id) LIKE ${term} ESCAPE '\\'
      OR LOWER(h.agent_id) LIKE ${term} ESCAPE '\\'
      OR LOWER(COALESCE(h.error,'')) LIKE ${term} ESCAPE '\\'
      OR LOWER(COALESCE(t.name,'')) LIKE ${term} ESCAPE '\\'
    )`);
  }
  const where = predicates.length ? sql`WHERE ${sql.join(predicates, sql` AND `)}` : sql``;
  const result = await db.execute(sql<HistoryRow>`
    WITH history AS (
      SELECT j.id, j.tenant_id, j.destination, j.document_type,
        j.agent_id, j.printer_id, j.requested_by, j.status, j.error,
        j.retries, j.delivery_attempts, j.claimed_at, j.delivered_at,
        j.acked_at, j.expires_at, j.created_at, j.updated_at, j.output_medium, j.output_evidence,
        FALSE AS archived
      FROM print_jobs j ${scopedWhere("j", input.tenantId)}
      UNION ALL
      SELECT r.id, r.tenant_id, r.destination, r.document_type,
        r.agent_id, r.printer_id, r.requested_by, r.status, r.error,
        NULL::integer AS retries, NULL::integer AS delivery_attempts,
        NULL::timestamp AS claimed_at, r.delivered_at,
        r.acked_at, NULL::timestamp AS expires_at, r.created_at, r.updated_at, r.output_medium, r.output_evidence,
        TRUE AS archived
      FROM print_job_receipts r ${scopedWhere("r", input.tenantId)}
      -- Job IDs belong to separate archival/live tables; only suppress
      -- the receipt when its own tenant has the matching live row.
      AND NOT EXISTS (SELECT 1 FROM print_jobs live WHERE live.id = r.id AND live.tenant_id = r.tenant_id)
    )
    SELECT h.id, h.tenant_id AS "tenantId", t.name AS "tenantName",
      h.agent_id AS "agentId", a.name AS "agentName",
      h.printer_id AS "printerId", p.name AS "printerName",
      h.destination, h.document_type AS "documentType",
      h.requested_by AS "requestedBy", h.status, h.error,
      h.retries, h.delivery_attempts AS "deliveryAttempts",
      h.claimed_at AS "claimedAt", h.delivered_at AS "deliveredAt",
      h.acked_at AS "ackedAt", h.expires_at AS "expiresAt",
      h.created_at AS "createdAt", h.updated_at AS "updatedAt", h.archived, h.output_medium AS "outputMedium", h.output_evidence AS "outputEvidence"
    FROM history h
    LEFT JOIN tenants t ON t.id = h.tenant_id
    LEFT JOIN agents a ON a.id = h.agent_id AND a.tenant_id = h.tenant_id
    LEFT JOIN printers p ON p.id = h.printer_id AND p.tenant_id = h.tenant_id
    ${where}
    ORDER BY h.created_at DESC, h.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
  const rows = result.rows as HistoryRow[];
  return rows.map(row => ({ ...row, ...printOutputPresentation(row) }));
}
