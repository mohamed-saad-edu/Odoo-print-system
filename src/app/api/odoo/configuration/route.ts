import { NextResponse } from "next/server";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { apiKeys } from "../../../../db/schema";
import { validateWorkspaceManager } from "../../../../lib/manager-auth";
import { requireManagerPermission } from "../../../../lib/authorization";
import { requireManagerActorInTransaction, ManagerMutationAuthorityChangedError } from "../../../../lib/manager-mutation-authorization";
import { logError } from "../../../../lib/log";
import { validateOdooKey } from "../../../../lib/odoo-auth";
import { requireActiveTenantInTransaction, TenantSuspendedError, TenantDeletedError } from "../../../../lib/tenant-guard";
import { writeAuditEvent } from "../../../../lib/audit";
import { isTenantBillingError, requireTenantBillingAccess } from "../../../../lib/entitlements";
import { hasBodyOverLimit } from "../../../../lib/request-limits";

export const dynamic = "force-dynamic";

/**
 * Gateway-side read for operators.
 * The activation state shown here is a replicated Odoo business setting,
 * scoped independently to each Odoo integration API key; it is not tenant lifecycle.
 */
const CONFIGURATION_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  const manager = await validateWorkspaceManager(req);
  if (!manager) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, headers: CONFIGURATION_HEADERS });
  try {
    requireManagerPermission(manager, "integrations.read");
  } catch {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403, headers: CONFIGURATION_HEADERS });
  }

  try {
    // Replicated activation is still tenant-private control-plane inventory.
    // Revalidate the authenticated principal and lifecycle at the read
    // boundary, not just before an unrelated concurrent role/session change.
    const integrations = await db.transaction(async tx => {
      await requireActiveTenantInTransaction(tx, manager.tenantId);
      await requireManagerActorInTransaction(tx, manager, "integrations.read");
      return tx.query.apiKeys.findMany({
        where: and(eq(apiKeys.tenantId, manager.tenantId), sql`${apiKeys.hashedKey} NOT LIKE 'deleted:%'`),
        columns: {
          id: true,
          name: true,
          odooEnabled: true,
          odooEnabledRevision: true,
          odooEnabledUpdatedAt: true,
          revokedAt: true,
        },
      });
    });
    return NextResponse.json({ integrations }, { status: 200, headers: CONFIGURATION_HEADERS });
  } catch (error) {
    if (error instanceof ManagerMutationAuthorityChangedError) {
      return NextResponse.json({ error: error.message, code: error.code },
        { status: error.status, headers: CONFIGURATION_HEADERS });
    }
    if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) {
      return NextResponse.json({ error: error.message, code: error.code },
        { status: 403, headers: CONFIGURATION_HEADERS });
    }
    logError("odoo.integration_configuration_read_failed", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Integration configuration unavailable", code: "INTEGRATION_CONFIGURATION_UNAVAILABLE" },
      { status: 503, headers: CONFIGURATION_HEADERS });
  }
}

/**
 * Odoo is the source of truth for the integration activation checkbox.
 * A monotonic revision prevents an older in-flight request from restoring
 * a stale state after a newer toggle has already reached the Gateway.
 */
export async function PATCH(req: Request) {
  if (hasBodyOverLimit(req, 16 * 1024)) return NextResponse.json({ error: "Request body too large", code: "INVALID_REQUEST" }, { status: 413, headers: CONFIGURATION_HEADERS });
  const apiKey = await validateOdooKey(req, { requireIntegrationEnabled: false });
  if (!apiKey) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (apiKey.readOnly) {
    return NextResponse.json(
      {
        error: "API key is in its rotation grace period and is read-only.",
        code: "API_KEY_READ_ONLY",
      },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  let body: unknown;
  try {
    const parsedBody = await req.json(); if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) throw new Error("JSON object required"); body = parsedBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const enabled = record.enabled;
  const revision = record.revision;

  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  // api_keys.odoo_enabled_revision is PostgreSQL int4, not bigint. Reject
  // out-of-range revisions before a billable transaction or SQL overflow.
  if (!Number.isInteger(revision) || Number(revision) < 0 || Number(revision) > 2_147_483_647) {
    return NextResponse.json({ error: "revision must be an integer between 0 and 2147483647" }, { status: 400 });
  }

  try {
    const updated = await db.transaction(async (tx) => {
      await requireActiveTenantInTransaction(tx, apiKey.tenantId);
      // Print admission locks api_keys before the subscription row. Follow
      // that SAME order when toggling activation: billing -> api_keys here
      // could otherwise deadlock against print admission's key -> billing.
      // This also fences revocation/rotation between HTTP auth and mutation.
      const liveKey = await tx.execute(sql`SELECT id FROM api_keys
        WHERE id = ${apiKey.id} AND tenant_id = ${apiKey.tenantId}
          AND hashed_key = ${apiKey.hashedKey}
          AND revoked_at IS NULL AND read_only_until IS NULL
        FOR UPDATE`);
      if (liveKey.rows.length === 0) return [];

      // Enabling Gateway printing is a billable/executable runtime state.
      // Keep the entitlement decision and activation mutation in the SAME
      // transaction. requireTenantBillingAccess() locks the subscription row
      // and therefore serializes this decision with Platform Owner manual subscription updates.
      // Disabling remains available after subscription expiry/cancellation so
      // Odoo can always converge the replicated state to OFF.
      if (enabled) {
        await requireTenantBillingAccess(tx, apiKey.tenantId);
      }

      const result = await tx.update(apiKeys)
        .set({
          odooEnabled: enabled,
          odooEnabledRevision: Number(revision),
          odooEnabledUpdatedAt: sql`clock_timestamp()`,
        })
        .where(and(
          eq(apiKeys.id, apiKey.id),
          eq(apiKeys.tenantId, apiKey.tenantId),
          eq(apiKeys.hashedKey, apiKey.hashedKey),
          sql`${apiKeys.revokedAt} IS NULL`,
          sql`${apiKeys.readOnlyUntil} IS NULL`,
          lt(apiKeys.odooEnabledRevision, Number(revision)),
        ))
        .returning({
          enabled: apiKeys.odooEnabled,
          revision: apiKeys.odooEnabledRevision,
          updatedAt: apiKeys.odooEnabledUpdatedAt,
        });

      if (result.length) {
        await writeAuditEvent({
          tenantId: apiKey.tenantId,
          actorType: "odoo",
          actorId: apiKey.id,
          action: "odoo.gateway_configuration.updated",
          resourceType: "api_key",
          resourceId: apiKey.id,
          metadata: { enabled, revision: Number(revision) },
        }, tx);
      }
      return result;
    });

    if (updated.length) {
      return NextResponse.json({ ok: true, applied: true, ...updated[0] }, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    }

    // A stale revision is an authorized read of the CURRENT integration
    // state, not an exemption from a key rotation or workspace suspension.
    // Perform the follow-up lookup behind the same tenant -> key row fences
    // used by the mutation; a revoked bearer must not get configuration
    // metadata merely because its earlier UPDATE affected zero rows.
    const current = await db.transaction(async (tx) => {
      await requireActiveTenantInTransaction(tx, apiKey.tenantId);
      const live = await tx.execute(sql`SELECT id FROM api_keys
        WHERE id = ${apiKey.id} AND tenant_id = ${apiKey.tenantId}
          AND hashed_key = ${apiKey.hashedKey} AND revoked_at IS NULL
          AND read_only_until IS NULL FOR SHARE`);
      if (!live.rows.length) return null;
      return tx.query.apiKeys.findFirst({
        where: and(eq(apiKeys.id, apiKey.id), eq(apiKeys.tenantId, apiKey.tenantId)),
        columns: {
          odooEnabled: true,
          odooEnabledRevision: true,
          odooEnabledUpdatedAt: true,
        },
      });
    });
    if (!current) return NextResponse.json({ error: "API key is no longer active", code: "UNAUTHORIZED" }, { status: 401 });

    if (Number(revision) < current.odooEnabledRevision) {
      return NextResponse.json({
        ok: true,
        applied: false,
        reason: "stale_revision",
        enabled: current.odooEnabled,
        revision: current.odooEnabledRevision,
        updatedAt: current.odooEnabledUpdatedAt,
      }, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (current.odooEnabled === enabled) {
      return NextResponse.json({
        ok: true,
        applied: false,
        reason: "already_current",
        enabled: current.odooEnabled,
        revision: current.odooEnabledRevision,
        updatedAt: current.odooEnabledUpdatedAt,
      }, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    }

    return NextResponse.json({
      error: "Conflicting Odoo gateway activation update for the same revision",
      current: {
        enabled: current.odooEnabled,
        revision: current.odooEnabledRevision,
        updatedAt: current.odooEnabledUpdatedAt,
      },
    }, { status: 409 });
  } catch (error) {
    if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) return NextResponse.json({ error: error.message, code: error.code }, { status: 403, headers: { "Cache-Control": "no-store" } });
    if (isTenantBillingError(error)) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
}
