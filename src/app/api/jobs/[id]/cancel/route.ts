import { requireActiveTenantInTransaction, TenantSuspendedError, TenantDeletedError } from "../../../../../lib/tenant-guard";
import { requireManagerActorInTransaction, ManagerMutationAuthorityChangedError } from "../../../../../lib/manager-mutation-authorization";
import { logError, requestIdFrom } from "../../../../../lib/log";
import { writeAuditEvent } from "../../../../../lib/audit";
import { NextResponse } from "next/server";
import { db } from "../../../../../db";
import { printJobs, printJobReceipts } from "../../../../../db/schema";
import { validateWorkspaceManager } from "../../../../../lib/manager-auth";
import { requireManagerPermission } from "../../../../../lib/authorization";
import { hasBodyOverLimit } from "../../../../../lib/request-limits";
import { refundTenantPrintCredit } from "../../../../../lib/entitlements";
import { and, eq, sql } from "drizzle-orm";
import { derivePhysicalOutcome } from "../../../../../lib/job-status";
import { recordJobEvent } from "../../../../../lib/job-timeline";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

// v4 (migration 0109): distinct operator cancellation. This REPLACES the
// v3 mapping (queued/claimed -> failed with cancel markers) — there is no
// longer a 'failed' cancel path and a 'canceled' cancel path live at the
// same time. Rows canceled under v3 keep their 'failed' + marker history
// (history is never rewritten); a repeat cancel on such a row returns the
// v3 idempotent shape, while every NEW cancel produces 'canceled'.
//   - queued (never claimed: claim_token IS NULL) -> canceled,
//     error JOB_CANCELED_BY_OPERATOR, physical outcome not_printed.
//     The admission credit IS refunded (see below); canceled_at and
//     cancel_reason are stamped. The claim token is NULL, so no agent
//     can ever dispatch this row afterwards.
//   - claimed (claimed-not-yet-printing: the Gateway row is still
//     'claimed', i.e. no printing report was ever accepted) -> canceled,
//     error UNKNOWN_PARTIAL_DELIVERY with a cancel note, claim token
//     PRESERVED. Physical outcome stays unknown: the agent may hold a
//     durable executed result it has not re-reported yet. The token is
//     cleared by the maintenance sweep after the 24h late-success window
//     (failed UNKNOWN rows use the same sweep). NO quota refund: a
//     claimed job may have printed, and refunding it would let
//     create-claim-cancel loops print for free.
//   - printing -> 409 JOB_ALREADY_PRINTING. There is no spooler-job abort
//     path; the job resolves via its terminal report or the stale-printing
//     sweeper, which yields unknown.
//   - terminal (success/failed/expired) -> 409 JOB_ALREADY_TERMINAL,
//     except an already-canceled row, which returns the cancel result
//     idempotently (cancel of already-canceled = success, never a second
//     transition and never a second refund).
// Quota proof (reconciles the v3 no-refund comment with the v4 brief):
// credit is consumed at ADMISSION (print-job-service reserves one credit
// in the same transaction as the job INSERT; replays return earlier
// without charging again), so a queued cancel DID consume a credit and
// the brief's "must not consume quota" is satisfied only by refunding
// it. The refund runs in the SAME transaction as the status transition,
// targets the admission month (date_trunc month of created_at, UTC),
// floors at zero, and is reachable only via the one-shot queued ->
// canceled conditional UPDATE — so a repeat cancel (already-canceled
// branch) cannot refund twice, and a create-cancel loop nets zero per
// iteration (one charge, at most one refund). Claimed cancels keep the
// v3 no-refund rule, justified by the unknown physical outcome.
// Permission: NO permission change was needed. jobs.cancel is in the
// FULL_ACCESS set (src/lib/authorization.ts), which every workspace
// manager role holds; billing.* stays owner-only, so the owner =
// billing+invites / members = full ops, no billing/invites rule is
// preserved. (Observation, not changed here: the viewer role also holds
// FULL_ACCESS today, including jobs.cancel; tightening that is a
// separate authorization decision, not a WP1 change.)
// Agent compatibility (old agents need no update): canceled rows never
// enter poll claim candidates (queued/claimed only), and an agent that
// already holds the payload gets a 409 on its printing report (fenced
// expected status is 'claimed'), which is a HARD STOP before any
// hardware byte (authorizeDispatchAfterReportFailure). An agent late
// re-report of success on a claimed-cancel is accepted inside the 24h
// token window via the canceled late-success path in the agent jobs
// route; after the window it gets 409 JOB_ALREADY_CANCELED and must not
// resurrect the row. Deliberate operator reprint (a new operation, new
// idempotency key, fresh credit) remains allowed; automatic resubmission
// must exclude canceled rows (Odoo action_retry only accepts failed +
// not_printed, so neither canceled variant is auto-retried from Odoo).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await validateWorkspaceManager(req);
  if (!claims) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });
  try { requireManagerPermission(claims, "jobs.cancel"); } catch { return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403, headers: PRIVATE_HEADERS }); }
  if (hasBodyOverLimit(req, 16 * 1024)) return NextResponse.json({ error: "Request body too large", code: "INVALID_REQUEST" }, { status: 413, headers: PRIVATE_HEADERS });
  let reason: string | undefined;
  try {
    const parsed = await req.json().catch(() => null);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as { reason?: unknown }).reason === "string") {
      const raw = (parsed as { reason: string }).reason;
      if (raw.length > 500) return NextResponse.json({ error: "Reason too long", code: "INVALID_REQUEST" }, { status: 400, headers: PRIVATE_HEADERS });
      reason = raw || undefined;
    }
  } catch { /* empty or unreadable body: cancel proceeds without a reason */ }
  const { id } = await params;

  type CancelResult =
    | { applied: true; fromStatus: "queued" | "claimed"; quotaRefunded: boolean; row: { agentId: string | null; printerId: string | null } }
    | { applied: false; status: string | null; error: string | null; quotaRefunded: boolean; archived: boolean };
  let result: CancelResult;
  try {
    result = await db.transaction(async (tx) => {
      await requireActiveTenantInTransaction(tx, claims.tenantId);
      await requireManagerActorInTransaction(tx, claims, "jobs.cancel");
      const queued = await tx.update(printJobs)
        .set({
          status: "canceled",
          error: `JOB_CANCELED_BY_OPERATOR: canceled by operator before dispatch${reason ? ` (${reason})` : ""}`.slice(0, 1000),
          canceledAt: sql`clock_timestamp()`,
          cancelReason: reason ?? null,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(and(
          eq(printJobs.id, id),
          eq(printJobs.tenantId, claims.tenantId),
          eq(printJobs.status, "queued"),
          sql`claim_token IS NULL`,
        ))
        .returning({ agentId: printJobs.agentId, printerId: printJobs.printerId, createdAt: printJobs.createdAt, deliveredAt: printJobs.deliveredAt, ackedAt: printJobs.ackedAt });
      if (queued.length === 1) {
        const row = queued[0]!;
        // Refund only a provably never-dispatched cancel: delivered/acked
        // evidence on a queued row is corrupt/legacy, and such a row must
        // not refund (its outcome is ambiguous). The common case has both
        // NULL. The refund and the transition commit or roll back together.
        let quotaRefunded = false;
        if (row.deliveredAt === null && row.ackedAt === null) {
          quotaRefunded = await refundTenantPrintCredit(tx, claims.tenantId, row.createdAt);
          if (quotaRefunded) {
            await tx.update(printJobs)
              .set({ quotaRefunded: true })
              .where(and(eq(printJobs.id, id), eq(printJobs.tenantId, claims.tenantId), eq(printJobs.status, "canceled")));
          }
        }
        return { applied: true, fromStatus: "queued", quotaRefunded, row: { agentId: row.agentId, printerId: row.printerId } } as CancelResult;
      }
      const claimed = await tx.update(printJobs)
        .set({
          status: "canceled",
          // Claim token deliberately preserved (see header comment).
          error: `UNKNOWN_PARTIAL_DELIVERY: job canceled by operator after claim; physical output unknown${reason ? ` (${reason})` : ""}`.slice(0, 1000),
          canceledAt: sql`clock_timestamp()`,
          cancelReason: reason ?? null,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(and(
          eq(printJobs.id, id),
          eq(printJobs.tenantId, claims.tenantId),
          eq(printJobs.status, "claimed"),
        ))
        .returning({ agentId: printJobs.agentId, printerId: printJobs.printerId });
      if (claimed.length === 1) return { applied: true, fromStatus: "claimed", quotaRefunded: false, row: claimed[0]! } as CancelResult;
      // A queued row still holding a claim token matches neither UPDATE
      // above, yet it is live — returning JOB_ALREADY_TERMINAL for it is
      // wrong and leaves it uncancellable. No normal writer creates this
      // state (claim and requeue set/clear the token atomically), so it
      // can only come from a legacy/corrupt row; treat it as a
      // claimed-cancel (unknown outcome, token preserved for the 24h
      // reconciliation window, no refund) rather than failing the operator.
      const queuedWithToken = await tx.update(printJobs)
        .set({
          status: "canceled",
          // Claim token deliberately preserved (see header comment).
          error: `UNKNOWN_PARTIAL_DELIVERY: job canceled by operator after claim; physical output unknown${reason ? ` (${reason})` : ""}`.slice(0, 1000),
          canceledAt: sql`clock_timestamp()`,
          cancelReason: reason ?? null,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(and(
          eq(printJobs.id, id),
          eq(printJobs.tenantId, claims.tenantId),
          eq(printJobs.status, "queued"),
          sql`claim_token IS NOT NULL`,
        ))
        .returning({ agentId: printJobs.agentId, printerId: printJobs.printerId });
      if (queuedWithToken.length === 1) return { applied: true, fromStatus: "claimed", quotaRefunded: false, row: queuedWithToken[0]! } as CancelResult;
      const row = await tx.select({ status: printJobs.status, error: printJobs.error, quotaRefunded: printJobs.quotaRefunded })
        .from(printJobs)
        .where(and(eq(printJobs.id, id), eq(printJobs.tenantId, claims.tenantId)))
        .limit(1);
      if (row.length === 1) return { applied: false, status: row[0]!.status, error: row[0]!.error, quotaRefunded: row[0]!.quotaRefunded, archived: false } as CancelResult;
      const receipt = await tx.query.printJobReceipts.findFirst({
        where: and(eq(printJobReceipts.id, id), eq(printJobReceipts.tenantId, claims.tenantId)),
      });
      return { applied: false, status: receipt ? "archived-terminal" : null, error: null, quotaRefunded: false, archived: Boolean(receipt) } as CancelResult;
    });
  } catch (error) {
    if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: PRIVATE_HEADERS });
    }
    if (error instanceof ManagerMutationAuthorityChangedError) return error.response();
    logError("jobs.cancel_failed", { tenantId: claims.tenantId, error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Job cancellation unavailable", code: "JOB_CANCEL_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS });
  }

  if (!result.applied) {
    if (result.status === null) return NextResponse.json({ error: "Not found", code: "JOB_NOT_FOUND" }, { status: 404, headers: PRIVATE_HEADERS });
    if (result.status === "canceled") {
      return NextResponse.json({
        ok: true, id, status: "canceled", canceled: true, alreadyCanceled: true,
        quotaRefunded: result.quotaRefunded,
        physicalOutcome: derivePhysicalOutcome("canceled", result.error),
        outcomeNote: "Cancellation was already applied; a claimed job's physical outcome stays unknown until reconciliation closes.",
      }, { headers: PRIVATE_HEADERS });
    }
    // v3 history: a row canceled under v3 is 'failed' with a cancel marker.
    // It stays failed (history is never rewritten); a repeat cancel is
    // still idempotent success, reported in the v3 shape.
    if (result.error?.startsWith("JOB_CANCELED_BY_OPERATOR") || result.error?.startsWith("UNKNOWN_PARTIAL_DELIVERY: job canceled by operator")) {
      return NextResponse.json({
        ok: true, id, status: "failed", canceled: true, alreadyCanceled: true,
        physicalOutcome: derivePhysicalOutcome("failed", result.error),
        outcomeNote: "Cancellation was already applied under the previous mapping; a claimed job's physical outcome stays unknown until reconciliation closes.",
      }, { headers: PRIVATE_HEADERS });
    }
    if (result.status === "printing") return NextResponse.json({ error: "Job is already printing and cannot be canceled", code: "JOB_ALREADY_PRINTING" }, { status: 409, headers: PRIVATE_HEADERS });
    return NextResponse.json({ error: "Job is already terminal and cannot be canceled", code: "JOB_ALREADY_TERMINAL" }, { status: 409, headers: PRIVATE_HEADERS });
  }

  const canceledError = result.fromStatus === "queued"
    ? "JOB_CANCELED_BY_OPERATOR"
    : "UNKNOWN_PARTIAL_DELIVERY: job canceled by operator after claim";
  try {
    await recordJobEvent({
      jobId: id, tenantId: claims.tenantId, stage: "blocked", status: "blocked",
      message: result.fromStatus === "queued" ? "Job canceled by operator before dispatch" : "Job canceled by operator after claim; physical output unknown",
      errorCode: result.fromStatus === "queued" ? "JOB_CANCELED_BY_OPERATOR" : "UNKNOWN_PARTIAL_DELIVERY",
      agentId: result.row.agentId ?? undefined, printerId: result.row.printerId ?? undefined,
      metadata: { fromStatus: result.fromStatus, quotaRefunded: result.quotaRefunded },
    });
  } catch { /* timeline failure must not undo an applied cancel */ }
  // WP-A (S3): this is the sharpest gap — a destructive, quota-affecting
  // action previously left no audit row. Audit only a newly applied cancel
  // (the idempotent already-canceled branch above writes nothing, so one
  // cancel is one row). An audit failure must never undo the cancel.
  await writeAuditEvent({ tenantId: claims.tenantId, actorType: "user", actorId: claims.userId,
    action: "job.canceled", resourceType: "print_job", resourceId: id,
    requestId: requestIdFrom(req), metadata: { fromStatus: result.fromStatus, quotaRefunded: result.quotaRefunded } }).catch((error) =>
    logError("audit_write_failed", { error: error instanceof Error ? error.message : "unknown" }));
  return NextResponse.json({
    ok: true, id, status: "canceled", canceled: true,
    quotaRefunded: result.quotaRefunded,
    physicalOutcome: derivePhysicalOutcome("canceled", canceledError),
    outcomeNote: result.fromStatus === "queued"
      ? (result.quotaRefunded
        ? "Canceled before dispatch; the job will not print. The monthly print credit was refunded."
        : "Canceled before dispatch; the job will not print. No admission-month credit was available to refund.")
      : "Cancellation requested after claim; the job will not be dispatched again, but physical output is unknown until reconciliation closes. No quota refund is given.",
  }, { headers: PRIVATE_HEADERS });
}
