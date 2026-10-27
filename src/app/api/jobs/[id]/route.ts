import { printOutputPresentation } from "../../../../lib/print-output";
import { requireActiveTenantInTransaction, TenantSuspendedError, TenantDeletedError } from "../../../../lib/tenant-guard";
import { requireManagerActorInTransaction, ManagerMutationAuthorityChangedError } from "../../../../lib/manager-mutation-authorization";
import { logError } from "../../../../lib/log";
import { NextResponse } from "next/server";
import { db } from "../../../../db";
import { printJobs, printJobReceipts } from "../../../../db/schema";
import { validateWorkspaceManager } from "../../../../lib/manager-auth";
import { hasManagerPermission, requireManagerPermission } from "../../../../lib/authorization";
import { and, eq } from "drizzle-orm";
import { buildJobDiagnosticPayload } from "../../../../lib/job-diagnostic-payload";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await validateWorkspaceManager(req);
  if (!claims) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });
  try { requireManagerPermission(claims, "jobs.read"); } catch { return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403, headers: PRIVATE_HEADERS }); }
  const { id } = await params;
  const includePayload = new URL(req.url).searchParams.get("includePayload") === "1";
  const canReadPayload = includePayload && hasManagerPermission(claims, "jobs.payload.read");
  // Password/session preflight is not sufficient for a later confidential
  // document read. Linearize live tenant and actor authority with BOTH the
  // active job and archived receipt lookups in one transaction.
  let detail;
  try {
    detail = await db.transaction(async tx => {
      await requireActiveTenantInTransaction(tx, claims.tenantId);
      await requireManagerActorInTransaction(tx, claims, "jobs.read");
      const row = await tx
        .select({
      id: printJobs.id,
      destination: printJobs.destination,
      documentType: printJobs.documentType,
      agentId: printJobs.agentId,
      printerId: printJobs.printerId,
      status: printJobs.status,
      outputMedium: printJobs.outputMedium,
      outputEvidence: printJobs.outputEvidence,
      error: printJobs.error,
      retries: printJobs.retries,
      deliveryAttempts: printJobs.deliveryAttempts,
      claimedAt: printJobs.claimedAt,
      deliveredAt: printJobs.deliveredAt,
      ackedAt: printJobs.ackedAt,
      expiresAt: printJobs.expiresAt,
      createdAt: printJobs.createdAt,
      updatedAt: printJobs.updatedAt,
      payload: printJobs.payload,
    })
    .from(printJobs)
    .where(and(eq(printJobs.id, id), eq(printJobs.tenantId, claims.tenantId)))
    .limit(1);
      const receipt = row.length === 1 ? null : await tx.query.printJobReceipts.findFirst({
        where: and(eq(printJobReceipts.id, id), eq(printJobReceipts.tenantId, claims.tenantId)),
      });
      return { row, receipt };
    });
  } catch (error) {
    if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: PRIVATE_HEADERS });
    }
    if (error instanceof ManagerMutationAuthorityChangedError) return error.response();
    logError("jobs.detail_read_failed", { tenantId: claims.tenantId, error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Job details unavailable", code: "JOB_DETAILS_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS });
  }
  const { row, receipt } = detail;
  if (row.length !== 1) {
    if (!receipt) return NextResponse.json({ error: "Not found", code: "JOB_NOT_FOUND" }, { status: 404, headers: PRIVATE_HEADERS });
    const { fingerprint: _fingerprint, closedClaimTokenHash: _claimHash, apiKeyId: _apiKey, ...metadata } = receipt;
    return NextResponse.json(
      { ...metadata, ...printOutputPresentation(metadata), archived: true, diagnosticPayload: null },
      { headers: PRIVATE_HEADERS },
    );
  }
  const { payload, ...metadata } = row[0];

  // Normal callers receive a redacted transport summary. The interactive job
  // inspector opts in explicitly to the original payload so an authorized
  // workspace manager can inspect/copy exactly what was admitted for this job.
  // The tenant predicate above prevents cross-workspace access, and no-store
  // keeps customer document content out of intermediary caches.
  const diagnosticPayload = canReadPayload
    ? payload ?? null
    : buildJobDiagnosticPayload(payload);

  return NextResponse.json(
    { ...metadata, ...printOutputPresentation(metadata), diagnosticPayload },
    { headers: PRIVATE_HEADERS },
  );
}
