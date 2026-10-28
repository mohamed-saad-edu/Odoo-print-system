import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "../../../../db";
import { TenantDeletedError, TenantSuspendedError, requireActiveTenantInTransaction } from "../../../../lib/tenant-guard";
import { validateOdooKey, requireOdooReadKeyInTransaction, OdooReadKeyUnavailableError } from "../../../../lib/odoo-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const key = await validateOdooKey(req, {
    requireIntegrationEnabled: false,
    requireActiveTenant: false,
  });
  if (!key) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  let enabled: boolean;
  try {
    // A setup health check is still an authenticated tenant inventory read.
    // Fence tenant lifecycle and API-key rotation/revocation in one transaction
    // so authentication performed before a concurrent mutation is not reused
    // to report success after the mutation has committed.
    enabled = await db.transaction(async tx => {
      await requireActiveTenantInTransaction(tx, key.tenantId);
      // Health is the narrowly scoped exception: report an authenticated
      // disabled integration without relaxing credential or tenant fences.
      await requireOdooReadKeyInTransaction(tx, key, false);
      const live = await tx.execute(sql`
        SELECT odoo_enabled AS enabled FROM api_keys
        WHERE id = ${key.id} AND tenant_id = ${key.tenantId}
          AND hashed_key = ${key.hashedKey} FOR SHARE
      `);
      if (live.rows.length !== 1) throw new OdooReadKeyUnavailableError();
      return live.rows[0].enabled === true;
    });
  } catch (error) {
    if (error instanceof OdooReadKeyUnavailableError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }

  return NextResponse.json(
    { ok: true, enabled },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
