import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../../../db";
import { apiKeys, odooInstallationCredentials, odooInstallations } from "../../../../../db/schema";
import { validateOdooKey } from "../../../../../lib/odoo-auth";
import { requireActiveTenantInTransaction } from "../../../../../lib/tenant-guard";
import { isTenantBillingError, requireTenantBillingAccess } from "../../../../../lib/entitlements";
import { writeAuditEvent } from "../../../../../lib/audit";
import { logError } from "../../../../../lib/log";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "no-store" };
const schema = z.object({
  installationId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  installationProof: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  name: z.string().trim().min(1).max(120).optional(),
}).strict();

function proofMatches(candidate: string, storedHash: string): boolean {
  const input = createHash("sha256").update(candidate).digest();
  const stored = /^[a-f0-9]{64}$/.test(storedHash)
    ? Buffer.from(storedHash, "hex") : Buffer.alloc(input.length);
  return timingSafeEqual(input, stored);
}

/**
 * Zero-touch, idempotent Odoo installation enrollment for newly provisioned
 * workspaces. A tenant with no historical jobs or receipts is atomically
 * promoted to strict-v2 at first enrollment. Historical tenants must
 * reconcile their print history before this one-way cutover.
 * One Odoo API key may connect multiple independent
 * Odoo databases. Installation proofs are generated on the Odoo host and
 * never returned from this endpoint or persisted as plaintext on Gateway.
 */
export async function POST(req: Request) {
  const key = await validateOdooKey(req, { requireIntegrationEnabled: false });
  if (!key || key.readOnly) {
    return NextResponse.json({ error: "Active Odoo integration key required" },
      { status: 401, headers: HEADERS });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid installation identity" },
      { status: 400, headers: HEADERS });
  }
  const { installationId, installationProof } = parsed.data;
  const secretHash = createHash("sha256").update(installationProof).digest("hex");
  try {
    const outcome = await db.transaction(async (tx) => {
      // Serialize with every Gateway print admission and the manual cutover:
      // print admission locks tenants FOR SHARE before accepting a job.
      const tenant = await tx.execute(sql`
        SELECT lifecycle, odoo_idempotency_mode AS mode
        FROM tenants WHERE id = ${key.tenantId} FOR UPDATE
      `);
      if (tenant.rows.length !== 1 || tenant.rows[0].lifecycle !== "active") {
        return "tenant_unavailable" as const;
      }
      await requireActiveTenantInTransaction(tx, key.tenantId);
      // Lock order is critical: print admission and activation acquire the
      // live API credential before billing. Avoid key/subscription deadlocks.
      // A concurrent rotate, delete, or revoke cannot create fresh authority.
      const active = await tx.select({ id: apiKeys.id }).from(apiKeys)
        .where(and(eq(apiKeys.id, key.id), eq(apiKeys.tenantId, key.tenantId),
          isNull(apiKeys.revokedAt), isNull(apiKeys.readOnlyUntil)))
        .for("share");
      if (active.length !== 1) return "invalid_key" as const;
      await requireTenantBillingAccess(tx, key.tenantId);
      if (tenant.rows[0].mode !== "strict_v2") {
        if (tenant.rows[0].mode !== "legacy") return "legacy_workspace" as const;
        const history = await tx.execute(sql`
          SELECT (
            EXISTS (SELECT 1 FROM print_jobs
                    WHERE tenant_id = ${key.tenantId} AND api_key_id IS NOT NULL)
            OR EXISTS (SELECT 1 FROM print_job_receipts
                       WHERE tenant_id = ${key.tenantId} AND api_key_id IS NOT NULL)
          ) AS has_history
        `);
        if (history.rows[0]?.has_history === true) return "legacy_workspace" as const;
        // One-way activation happens before installation enrollment in this
        // same transaction; failures roll back BOTH mutations.
        await tx.execute(sql`
          UPDATE tenants SET odoo_idempotency_mode = 'strict_v2',
            updated_at = clock_timestamp()
          WHERE id = ${key.tenantId}
        `);
      }

      // The primary key enforces one immutable proof per ID. Concurrent
      // first-time registrations converge; mismatched proofs never rebind.
      const created = await tx.insert(odooInstallations).values({
        id: installationId,
        tenantId: key.tenantId,
        name: parsed.data.name ?? "Odoo installation",
        secretHash,
      }).onConflictDoNothing({ target: odooInstallations.id })
        .returning({ id: odooInstallations.id });
      const rows = await tx.select({
        tenantId: odooInstallations.tenantId,
        secretHash: odooInstallations.secretHash,
        enabled: odooInstallations.enabled,
      }).from(odooInstallations)
        .where(eq(odooInstallations.id, installationId)).for("share");
      if (rows.length !== 1 || rows[0].tenantId !== key.tenantId ||
        !rows[0].enabled || !proofMatches(installationProof, rows[0].secretHash)) {
        return "identity_conflict" as const;
      }
      await tx.insert(odooInstallationCredentials).values({
        tenantId: key.tenantId, installationId, apiKeyId: key.id,
      }).onConflictDoNothing();
      if (created.length) {
        await writeAuditEvent({
          tenantId: key.tenantId, actorType: "odoo", actorId: key.id,
          action: "odoo.installation.auto_enrolled",
          resourceType: "odoo_installation", resourceId: installationId,
          metadata: { automated: true },
        }, tx);
      }
      return created.length ? "created" as const : "existing" as const;
    });
    if (outcome === "legacy_workspace") return NextResponse.json({
      error: "Legacy workspace requires print-history reconciliation",
      code: "RECONCILIATION_REQUIRED",
    }, { status: 409, headers: HEADERS });
    if (outcome === "tenant_unavailable") return NextResponse.json({
      error: "Workspace is unavailable",
    }, { status: 403, headers: HEADERS });
    if (outcome === "invalid_key") return NextResponse.json({
      error: "Odoo integration key is no longer active",
    }, { status: 401, headers: HEADERS });
    if (outcome === "identity_conflict") return NextResponse.json({
      error: "Installation identity conflict; review cloned deployment",
      code: "INSTALLATION_OWNERSHIP_CONFLICT",
    }, { status: 409, headers: HEADERS });
    return NextResponse.json({ installationId, idempotencyVersion: 2, state: outcome },
      { status: outcome === "created" ? 201 : 200, headers: HEADERS });
  } catch (error) {
    if (isTenantBillingError(error)) {
      return NextResponse.json({ error: "Active subscription required", code: error.code },
        { status: 403, headers: HEADERS });
    }
    logError("odoo.installation.auto_enrollment_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "Installation enrollment unavailable" },
      { status: 503, headers: HEADERS });
  }
}
