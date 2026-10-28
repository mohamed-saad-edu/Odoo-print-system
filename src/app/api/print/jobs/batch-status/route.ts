import { printOutputPresentation } from "../../../../../lib/print-output";
import { NextResponse } from "next/server";
import { db } from "../../../../../db";
import { printJobs, printJobReceipts } from "../../../../../db/schema";
import { validateOdooKey } from "../../../../../lib/odoo-auth";
import { OdooNamespaceError } from "../../../../../lib/odoo-v2-admission";
import { odooStatusIdentity, odooStatusJobScope, odooStatusColumns, requireOdooStatusAccess } from "../../../../../lib/odoo-status-scope";
import { hasBodyOverLimit } from "../../../../../lib/request-limits";
import { and, inArray, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { isExactPrinterId } from "../../../../../lib/exact-printer-id";

export const dynamic = "force-dynamic";

const MAX_BODY = 64 * 1024;

const batchQuerySchema = z.object({
  jobIds: z.array(z.string().min(1).max(120).refine(isExactPrinterId, { message: "jobId must be the exact accepted job identity" })).min(1).max(100),
}).strict();

function responseForRow(row: Pick<typeof printJobs.$inferSelect, "id" | "status" | "printerId" | "agentId" | "destination" | "documentType" | "error" | "deliveredAt" | "ackedAt" | "updatedAt" | "outputMedium" | "outputEvidence">) {
  return {
    ...printOutputPresentation(row),
    jobId: row.id,
    status: row.status,
    printerId: row.printerId,
    agentId: row.agentId,
    destination: row.destination,
    documentType: row.documentType,
    error: row.error,
    deliveredAt: row.deliveredAt,
    ackedAt: row.ackedAt,
    updatedAt: row.updatedAt,
  };
}

export async function POST(req: Request) {
  if (hasBodyOverLimit(req, MAX_BODY)) return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  const odoo = await validateOdooKey(req);
  if (!odoo) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let identity: Awaited<ReturnType<typeof odooStatusIdentity>>;
  try {
    identity = await odooStatusIdentity(req, odoo.tenantId);
  } catch (error) {
    if (error instanceof OdooNamespaceError) return NextResponse.json({ error: error.code, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    throw error;
  }

  let body: unknown;
  try {
    const parsedBody = await req.json(); if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) throw new Error("JSON object required"); body = parsedBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_BODY", retryable: false }, { status: 400 });
  }

  const parsed = batchQuerySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid jobIds array", code: "INVALID_PAYLOAD", retryable: false }, { status: 400 });
  }

  const uniqueIds = Array.from(new Set(parsed.data.jobIds));
  try {
    const jobs = await db.transaction(async (tx) => {
      await requireOdooStatusAccess(tx, odoo, identity);
      const rows = await tx.query.printJobs.findMany({
        columns: odooStatusColumns,
        where: and(
          inArray(printJobs.id, uniqueIds),
          eq(printJobs.tenantId, odoo.tenantId),
          isNotNull(printJobs.apiKeyId),
          odooStatusJobScope(printJobs.id, odoo.tenantId, identity),
        ),
      });
      const found = new Set(rows.map(row => row.id));
      const missing = uniqueIds.filter(id => !found.has(id));
      const receipts = missing.length ? await tx.query.printJobReceipts.findMany({
        columns: odooStatusColumns,
        where: and(
          inArray(printJobReceipts.id, missing),
          eq(printJobReceipts.tenantId, odoo.tenantId),
          isNotNull(printJobReceipts.apiKeyId),
          odooStatusJobScope(printJobReceipts.id, odoo.tenantId, identity),
        ),
      }) : [];
      return [...rows.map(responseForRow), ...receipts.map(responseForRow)];
    });
    return NextResponse.json({ jobs }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OdooNamespaceError) return NextResponse.json({ error: error.code, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    throw error;
  }
}
