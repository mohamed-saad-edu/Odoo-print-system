import { NextResponse } from "next/server";
import { db } from "../../../../db";
import { printJobs, printJobReceipts } from "../../../../db/schema";
import { validateOdooKey } from "../../../../lib/odoo-auth";
import { validatePrintJobPayload, type PrintJobPayload } from "../../../../lib/payload";
import { createPrintJobForPrinter, AgentQueueFullError, AgentQueuedJobsFullError, PrintJobCapabilityError, PrintJobInputError } from "../../../../lib/print-job-service";
import { TenantEntitlementError, TenantPrintQuotaExceededError, isTenantBillingError } from "../../../../lib/entitlements";
import { hasBodyOverLimit } from "../../../../lib/request-limits";
import { logError, logWarn, requestIdFrom } from "../../../../lib/log";
import { databaseNowMs } from "../../../../lib/database-clock";
import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * Controlled migration switch for the v1 print-submission contract.
 *
 * Production defaults to requiring a stable `idempotencyKey`: a missing key
 * would make retries create duplicate physical prints. Development/test can
 * exercise legacy callers; explicit "0" is a temporary production escape
 * hatch that the operator must accept as an at-least-once printing risk.
 * v2 always requires the key.
 */
function idempotencyKeyRequired(): boolean {
  if (process.env.NODE_ENV === "production") {
    return process.env.YASEIR_REQUIRE_IDEMPOTENCY_KEY !== "0";
  }
  return process.env.YASEIR_REQUIRE_IDEMPOTENCY_KEY === "1";
}

const MAX_BODY = 8 * 1024 * 1024;
const bodySchema = z.object({
  printerId: z.string().trim().min(1).max(120),
  documentType: z.string().trim().min(1).max(120),
  destination: z.string().trim().min(1).max(255).optional(),
  payload: z.unknown(),
  expiresAt: z.string().optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict();

function parseExpiresAt(value?: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("expiresAt must be a valid ISO-8601 timestamp");
  // Relative TTL/future validation belongs to the Gateway database clock in
  // createPrintJobForPrinter. This parser only validates syntax so an app-host
  // clock drift can never reject/accept a job inconsistently with the DB.
  return parsed;
}

function responseForRow(row: Pick<typeof printJobs.$inferSelect, "id" | "status" | "printerId" | "agentId" | "destination" | "documentType" | "error">) {
  return {
    jobId: row.id,
    status: row.status,
    printerId: row.printerId,
    agentId: row.agentId,
    destination: row.destination,
    documentType: row.documentType,
    error: row.error,
  };
}


function idempotencyConflict() {
  return NextResponse.json({ error: "IDEMPOTENCY_CONFLICT", code: "IDEMPOTENCY_CONFLICT", retryable: false }, { status: 409 });
}

export async function POST(req: Request) {
  if (hasBodyOverLimit(req, MAX_BODY)) return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  const odoo = await validateOdooKey(req);
  if (!odoo) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (odoo.readOnly) {
    return NextResponse.json(
      {
        error: "API key is in its rotation grace period and is read-only.",
        code: "API_KEY_READ_ONLY",
        retryable: false,
        upgradeRequired: false,
      },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  if (!parsed.data.idempotencyKey) {
    // A submission without a stable operation id cannot be deduplicated: a
    // retry creates a second queued job and can print twice. Callers that
    // cannot supply a key are rejected outright once the operator opts in
    // through the migration switch, so the duplicate risk can be removed
    // without a breaking API change.
    if (idempotencyKeyRequired()) {
      logWarn("print.job.idempotency_key_required", {
        tenantId: odoo?.tenantId ?? null,
        message: "Print job rejected: idempotencyKey is required for this deployment.",
      });
      return NextResponse.json(
        { error: "idempotencyKey is required for this deployment", code: "IDEMPOTENCY_KEY_REQUIRED", retryable: false },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    // Backward-compatible: legacy callers without a stable operation id are
    // accepted, but retries cannot be deduplicated and may produce duplicate
    // physical prints. New callers must supply an idempotencyKey. A future
    // API version will require it (see ADR/migration notes).
    logWarn("print.job.missing_idempotency_key", {
      tenantId: odoo?.tenantId ?? null,
      message: "Print job submitted without idempotencyKey; retry deduplication is disabled for this request.",
    });
  }

  let payload: PrintJobPayload;
  try { payload = validatePrintJobPayload(parsed.data.payload); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid payload" }, { status: 400 }); }

  let expiresAt: Date | undefined;
  try { expiresAt = parseExpiresAt(parsed.data.expiresAt); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid expiresAt" }, { status: 400 }); }

  // No early GET-and-return: between validateOdooKey() and this write an
  // operator can revoke/rotate the integration key. The transactional service
  // locks the live key before checking any job or idempotency receipt.

  try {
    const result = await createPrintJobForPrinter(parsed.data.printerId, payload, {
      requestedBy: "odoo",
      idempotencyKey: parsed.data.idempotencyKey ?? null,
      destination: parsed.data.destination ?? null,
      documentType: parsed.data.documentType,
      expiresAt,
      rateLimitKeyId: odoo.id,
      tenantId: odoo.tenantId,
      requestId: requestIdFrom(req),
    });
    if (result.isReused) {
      const existing = await db.query.printJobs.findFirst({
        where: and(
          eq(printJobs.id, result.id),
          eq(printJobs.tenantId, odoo.tenantId),
          isNotNull(printJobs.apiKeyId),
        ),
      });
      if (existing) {
        return NextResponse.json(responseForRow(existing), { status: 200 });
      }
      const receipt = await db.query.printJobReceipts.findFirst({ where: and(eq(printJobReceipts.id, result.id), eq(printJobReceipts.tenantId, odoo.tenantId), isNotNull(printJobReceipts.apiKeyId)) });
      if (receipt) return NextResponse.json(responseForRow(receipt), { status: 200 });
      // The reused job was deleted concurrently; do not fall through to a
      // 201 describing a job that no longer exists.
      return NextResponse.json({ error: "IDEMPOTENCY_CONFLICT", code: "IDEMPOTENCY_CONFLICT", retryable: false }, { status: 409 });
    }
    const responseHeaders: Record<string, string> = {};
    if (!parsed.data.idempotencyKey) {
      responseHeaders["X-Idempotency-Warning"] = "missing-key; retry deduplication disabled";
    }
    return NextResponse.json({
      jobId: result.id,
      status: result.status,
      printerId: result.printerId,
      agentId: result.agentId,
      destination: parsed.data.destination ?? null,
      documentType: parsed.data.documentType,
    }, { status: 201, headers: responseHeaders });
  } catch (error) {
    if (error instanceof TenantPrintQuotaExceededError) {
      const response: Record<string, unknown> = {
        error: error.message,
        code: error.code,
        entitlement: error.entitlement,
        limit: error.limit,
        used: error.used,
        remaining: 0,
        periodStart: error.periodStart.toISOString(),
        periodEnd: error.periodEnd?.toISOString() ?? null,
        upgradeRequired: true,
        retryable: false,
      };
      const headers = new Headers({ "Cache-Control": "no-store" });
      if (error.periodEnd) {
        try {
          const dbNowMs = await databaseNowMs();
          headers.set("Retry-After", String(Math.max(1, Math.ceil((error.periodEnd.getTime() - dbNowMs) / 1000))));
        } catch {
          headers.set("Retry-After", "60");
        }
      }
      return NextResponse.json(response, { status: 429, headers });
    }
    if (error instanceof TenantEntitlementError) {
      return NextResponse.json({
        error: error.message,
        code: error.code,
        entitlement: error.entitlement,
        limit: error.limit,
        used: error.used,
        upgradeRequired: true,
        retryable: true,
      }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
    }
    if (isTenantBillingError(error)) return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
    if (error instanceof AgentQueueFullError || error instanceof AgentQueuedJobsFullError) {
      return NextResponse.json({ error: error.code, code: error.code, retryable: true }, { status: 503 });
    }
    if (error instanceof PrintJobCapabilityError) {
      return NextResponse.json({ error: error.message, code: error.code, retryable: false }, { status: 422 });
    }
    if (error instanceof PrintJobInputError) {
      return NextResponse.json({ error: error.message, code: error.code, retryable: error.status >= 500 }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid payload", code: "INVALID_PAYLOAD", retryable: false }, { status: 400 });
    }
    if (error instanceof Error && (error as Error & { code?: string }).code === "IDEMPOTENCY_CONFLICT" && parsed.data.idempotencyKey) {
      // The transactional service returns matching replays. A reported
      // conflict therefore represents a DIFFERENT operation or identity;
      // never turn that explicit refusal into HTTP 200 with a racy read.
      return idempotencyConflict();
    }
    // Anything else is an internal failure: log the detail, return a generic
    // sanitized error. Database constraint names, driver messages, and
    // stack traces never leave the server.
    logError("print.job.create_failed", { key: parsed.data.idempotencyKey ?? null, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Internal server error", code: "INTERNAL_ERROR", retryable: true }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const odoo = await validateOdooKey(req);
  if (!odoo) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const id = params.get("id")?.trim();
  const idempotencyKey = params.get("idempotencyKey")?.trim();
  if (idempotencyKey && idempotencyKey.length > 200) {
    return NextResponse.json({ error: "idempotencyKey is too long" }, { status: 400 });
  }
  if (id && idempotencyKey) {
    return NextResponse.json({ error: "Provide exactly one lookup key" }, { status: 400 });
  }
  if (!id && !idempotencyKey) {
    return NextResponse.json({ error: "id or idempotencyKey query param required" }, { status: 400 });
  }
  // Odoo API-key authentication establishes the integration tenant. Only
  // Odoo-originated jobs belong to this API surface; `apiKeyId` must be present
  // but must not equal the current credential so rotated keys can still read
  // historical jobs. The idempotency-key lookup closes the ambiguous-POST
  // recovery gap: Odoo may know the durable operation key while having lost the
  // Gateway job id because the response timed out after Gateway acceptance.
  const row = await db.query.printJobs.findFirst({
    where: and(
      ...(id ? [eq(printJobs.id, id)] : [eq(printJobs.idempotencyKey, idempotencyKey!)]),
      eq(printJobs.tenantId, odoo.tenantId),
      isNotNull(printJobs.apiKeyId),
    ),
  });
  const receipt = row ? null : await db.query.printJobReceipts.findFirst({ where: and(
    ...(id ? [eq(printJobReceipts.id, id)] : [eq(printJobReceipts.idempotencyKey, idempotencyKey!)]),
    eq(printJobReceipts.tenantId, odoo.tenantId), isNotNull(printJobReceipts.apiKeyId),
  ) });
  if (!row && !receipt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(responseForRow(row ?? receipt!), { status: 200 });
}
