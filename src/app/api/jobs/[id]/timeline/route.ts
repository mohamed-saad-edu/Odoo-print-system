import { NextResponse } from "next/server";
import { db } from "../../../../../db";
import { jobEvents, printJobs, printJobReceipts } from "../../../../../db/schema";
import { validateWorkspaceManager } from "../../../../../lib/manager-auth";
import { requireManagerPermission } from "../../../../../lib/authorization";
import { requireActiveTenantInTransaction, TenantSuspendedError, TenantDeletedError } from "../../../../../lib/tenant-guard";
import { requireManagerActorInTransaction, ManagerMutationAuthorityChangedError } from "../../../../../lib/manager-mutation-authorization";
import { and, eq } from "drizzle-orm";
import { getJobTimelineInTransaction } from "../../../../../lib/job-timeline";
import { persistedTimelinePresentation } from "../../../../../lib/job-timeline-presentation";
import { runWithCorrelation, generateRequestId } from "../../../../../server/correlation";
import { requestIdFrom, logError, logWarn, redactClaimToken } from "../../../../../lib/log";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

type JobEventRow = typeof jobEvents.$inferSelect;
type TimelineEntry = {
  id: string;
  stage: string;
  status: string;
  at?: Date | null;
  message?: string | null;
  /** Translation key for the detail line; absent for persisted audit text. */
  messageKey?: string | null;
  messageVars?: Record<string, string | number> | null;
  errorCode?: string | null;
  attemptId?: string | null;
  claimId?: string | null;
  spoolerJobId?: string | null;
  agentId?: string | null;
  printerId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await validateWorkspaceManager(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  try { requireManagerPermission(auth, "jobs.read"); } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE_HEADERS });
  }

  const tenantId = auth.tenantId;
  const requestId = requestIdFrom(req) || generateRequestId();
  const correlation = { requestId, tenantId, jobId: id };

  return runWithCorrelation(correlation, async () => {
    // Print history, archived receipts, event messages and claim correlations
    // are confidential. Preflight login cannot authorize reads after a
    // concurrent owner-role change, logout or tenant suspension. Hold the
    // exact current tenant/session fence through every SELECT.
    let snapshot;
    try {
      snapshot = await db.transaction(async tx => {
        await requireActiveTenantInTransaction(tx, tenantId);
        await requireManagerActorInTransaction(tx, auth, "jobs.read");
        const rows = await tx.query.printJobs.findMany({
          where: and(eq(printJobs.tenantId, tenantId), eq(printJobs.id, id)),
          columns: { payload: false }, limit: 1,
        });
        const receipt = rows.length === 0
          ? await tx.query.printJobReceipts.findFirst({
              where: and(eq(printJobReceipts.tenantId, tenantId), eq(printJobReceipts.id, id)),
            })
          : null;
        let events: JobEventRow[] = [];
        if (rows.length) {
          try {
            // A nested savepoint keeps the established degraded-mode fallback:
            // failure to load audit events never discards the available job
            // row, while a broken event SELECT cannot poison the outer read.
            events = await tx.transaction(savepoint =>
              getJobTimelineInTransaction(savepoint, tenantId, id));
          } catch (error) {
            logWarn("job.timeline_lookup_failed", { requestId, tenantId, jobId: id,
              error: error instanceof Error ? error.message : "unknown" });
          }
        }
        return { rows, receipt, events };
      });
    } catch (error) {
      if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) {
        return NextResponse.json({ error: error.message, code: error.code },
          { status: error.status, headers: { ...PRIVATE_HEADERS, "x-request-id": requestId } });
      }
      if (error instanceof ManagerMutationAuthorityChangedError) return error.response();
      logError("job.timeline_read_failed", { requestId, tenantId, jobId: id,
        error: error instanceof Error ? error.message : "unknown" });
      return NextResponse.json({ error: "Print timeline unavailable", code: "JOB_TIMELINE_UNAVAILABLE" },
        { status: 503, headers: { ...PRIVATE_HEADERS, "x-request-id": requestId } });
    }

    const { rows, receipt, events } = snapshot;
    if (rows.length === 0) {
      if (receipt) return NextResponse.json({ jobId: id, tenantId, status: receipt.status, archived: true,
        timeline: [],
        evidence: {
          source: "archived_receipt",
          recordedEventCount: 0,
          job: {
            status: receipt.status,
            createdAt: receipt.createdAt,
            updatedAt: receipt.updatedAt,
            agentId: receipt.agentId,
            printerId: receipt.printerId,
          },
        },
        correlation: { requestId, jobId: id, tenantId, agentId: receipt.agentId, printerId: receipt.printerId },
      }, { headers: { ...PRIVATE_HEADERS, "x-request-id": requestId } });
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: { ...PRIVATE_HEADERS, "x-request-id": requestId } });
    }
    const job = rows[0];

    const timeline: TimelineEntry[] = events.map((e: JobEventRow) => ({
      id: e.id,
      stage: e.stage,
      // Historical printing events used status=ok and an English message,
      // despite being no more than agent execution admission. Render those
      // records as pending, too; their historical DB rows stay immutable.
      status: persistedTimelinePresentation(e).status,
      at: e.createdAt,
      message: e.message,
      messageKey: persistedTimelinePresentation(e).messageKey,
      errorCode: e.errorCode,
      attemptId: e.attemptId,
      claimId: redactClaimToken(e.claimId),
      spoolerJobId: e.spoolerJobId,
      agentId: e.agentId,
      printerId: e.printerId,
      requestId: e.requestId,
      metadata: e.metadata,
    }));

    const res = NextResponse.json(
      {
        jobId: id,
        tenantId,
        status: job.status,
        spoolerJobId: job.spoolerJobId,
        attemptId: job.attemptId,
        timeline,
        evidence: {
          source: timeline.length > 0 ? "persisted_events" : "job_record_only",
          recordedEventCount: timeline.length,
          job: {
            status: job.status,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            claimedAt: job.claimedAt,
            deliveredAt: job.deliveredAt,
            ackedAt: job.ackedAt,
            expiresAt: job.expiresAt,
            error: job.error,
            deliveryAttempts: job.deliveryAttempts,
            retries: job.retries,
            attemptId: job.attemptId,
            spoolerJobId: job.spoolerJobId,
          },
        },
        correlation: {
          requestId,
          jobId: id,
          tenantId,
          agentId: job.agentId,
          printerId: job.printerId,
          attemptId: job.attemptId,
          // Redacted claimId — never raw token
          claimId: redactClaimToken(job.claimToken),
          spoolerJobId: job.spoolerJobId,
        },
      },
      { headers: { ...PRIVATE_HEADERS, "x-request-id": requestId } }
    );
    return res;
  });
}
