import { randomBytes, randomUUID, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../../db";
import { odooInstallations, odooInstallationCredentials } from "../../../../db/schema";
import { validateWorkspaceManager } from "../../../../lib/manager-auth";
import { requireManagerPermission } from "../../../../lib/authorization";
import { requireManagerActorInTransaction, ManagerMutationAuthorityChangedError } from "../../../../lib/manager-mutation-authorization";
import { requireActiveTenantInTransaction } from "../../../../lib/tenant-guard";
import { writeAuditEvent } from "../../../../lib/audit";
import { logError } from "../../../../lib/log";

export const dynamic = "force-dynamic";

const enrollSchema = z.object({
  name: z.string().trim().min(1).max(120),
  apiKeyId: z.string().trim().min(1).max(128),
}).strict();

export async function GET(req: Request) {
  const manager = await validateWorkspaceManager(req);
  if (!manager) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { requireManagerPermission(manager, "integrations.read"); }
  catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }
  const rows = await db.execute(sql`
    SELECT i.id, i.name, i.enabled, i.created_at, i.disabled_at,
           array_agg(c.api_key_id ORDER BY c.created_at) AS api_key_ids
    FROM odoo_installations i
    JOIN odoo_installation_credentials c ON c.tenant_id = i.tenant_id AND c.installation_id = i.id
    WHERE i.tenant_id = ${manager.tenantId}
    GROUP BY i.id, i.name, i.enabled, i.created_at, i.disabled_at
    ORDER BY i.created_at DESC
  `);
  return NextResponse.json(rows.rows, { headers: { "Cache-Control": "no-store" } });
}

/** Enrollment is operator-only. Never register automatically from a client-controlled database UUID. */
export async function POST(req: Request) {
  const manager = await validateWorkspaceManager(req);
  if (!manager) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { requireManagerPermission(manager, "integrations.manage"); }
  catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }
  const parsed = enrollSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "name and API key are required" }, { status: 400 });
  const installationId = randomUUID();
  const proof = randomBytes(32).toString("base64url");
  const secretHash = createHash("sha256").update(proof).digest("hex");
  try {
    const enrolled = await db.transaction(async (tx) => {
      await requireActiveTenantInTransaction(tx, manager.tenantId);
      await requireManagerActorInTransaction(tx, manager, "integrations.manage");
      // Unique credential ownership enforces a separate Gateway key for each
      // independent Odoo deployment. A copied database cannot enroll by itself.
      const credential = await tx.execute(sql`
        SELECT id FROM api_keys WHERE id = ${parsed.data.apiKeyId} AND tenant_id = ${manager.tenantId}
          AND revoked_at IS NULL AND read_only_until IS NULL AND odoo_enabled = TRUE FOR UPDATE
      `);
      if (!credential.rows.length) return false;
      const bound = await tx.execute(sql`
        SELECT installation_id FROM odoo_installation_credentials
        WHERE tenant_id = ${manager.tenantId} AND api_key_id = ${parsed.data.apiKeyId} FOR UPDATE
      `);
      if (bound.rows.length) return false;
      await tx.insert(odooInstallations).values({ id: installationId, tenantId: manager.tenantId, name: parsed.data.name, secretHash });
      await tx.insert(odooInstallationCredentials).values({ tenantId: manager.tenantId, installationId, apiKeyId: parsed.data.apiKeyId });
      await writeAuditEvent({ tenantId: manager.tenantId, actorType: manager.userId ? "user" : "system",
        actorId: manager.userId ?? "legacy-manager", action: "odoo.installation.enrolled",
        resourceType: "odoo_installation", resourceId: installationId, metadata: { keyId: parsed.data.apiKeyId } }, tx);
      return true;
    });
    if (!enrolled) return NextResponse.json({ error: "Active unbound Odoo credential required", code: "ENROLLMENT_CONFLICT" }, { status: 409 });
    return NextResponse.json({ installationId, installationProof: proof, note: "Save this 256-bit proof OUTSIDE the Odoo database in YASEIR_ODOO_INSTALLATION_PROOFS. It is shown only once. Restore/clone operations require operator re-enrollment." },
      { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ManagerMutationAuthorityChangedError) return NextResponse.json({ error: "Permission changed" }, { status: 403 });
    logError("odoo.installation.enrollment_failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Enrollment unavailable" }, { status: 500 });
  }
}
