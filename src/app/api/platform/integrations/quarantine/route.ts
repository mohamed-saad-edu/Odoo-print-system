import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../../../db";
import { odooInstallations } from "../../../../../db/schema";
import {
  requirePlatformOwner, requirePlatformActorInTransaction,
  PlatformUnauthorizedError, PlatformMutationAuthorityChangedError,
} from "../../../../../lib/platform-auth";
import { hasBodyOverLimit } from "../../../../../lib/request-limits";
import { writeAuditEvent } from "../../../../../lib/audit";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };
const inputSchema = z.object({
  tenantId: z.string().trim().min(1).max(120),
  id: z.string().trim().min(1).max(150),
  confirmId: z.string().trim().min(1).max(150),
  reason: z.string().trim().min(10).max(500),
}).strict();

/** Fail-closed stop of new Odoo-v2 admission, not a replay or migration cutover. */
export async function POST(req: Request) {
  let actor;
  try { actor = await requirePlatformOwner(req); }
  catch (error) {
    return NextResponse.json({ error: error instanceof PlatformUnauthorizedError ? "Unauthorized" : "Authentication unavailable" },
      { status: error instanceof PlatformUnauthorizedError ? 401 : 503, headers: HEADERS });
  }
  if (hasBodyOverLimit(req, 4 * 1024)) return NextResponse.json({ error: "Request too large" }, { status: 413, headers: HEADERS });
  const parsed = inputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.id !== parsed.data.confirmId) return NextResponse.json({ error: "Confirm the exact installation ID and provide a reason" }, { status: 400, headers: HEADERS });
  const { tenantId, id, reason } = parsed.data;
  try {
    const result = await db.transaction(async tx => {
      const rows = await tx.select({ id: odooInstallations.id, enabled: odooInstallations.enabled })
        .from(odooInstallations).where(and(eq(odooInstallations.tenantId, tenantId), eq(odooInstallations.id, id))).for("update");
      if (!rows[0]) return { status: 404, error: "Installation not found" } as const;
      if (!rows[0].enabled) return { status: 409, error: "Installation already quarantined" } as const;
      await requirePlatformActorInTransaction(tx, actor);
      const disabled = await tx.update(odooInstallations)
        .set({ enabled: false, disabledAt: sql`clock_timestamp()` })
        .where(and(eq(odooInstallations.id, id), eq(odooInstallations.tenantId, tenantId), eq(odooInstallations.enabled, true)))
        .returning({ id: odooInstallations.id });
      if (disabled.length !== 1) return { status: 409, error: "Installation changed; reload" } as const;
      await writeAuditEvent({
        tenantId, actorType: "platform", actorId: actor.userId,
        action: "odoo_installation.quarantined", resourceType: "odoo_installation", resourceId: id,
        metadata: { reason, effect: "block_new_v2_admission", requiresNewProofForRecovery: true },
      }, tx);
      return { status: 200, ok: true, id, tenantId, quarantined: true } as const;
    });
    return NextResponse.json(result, { status: result.status, headers: HEADERS });
  } catch (error) {
    if (error instanceof PlatformMutationAuthorityChangedError) return NextResponse.json({ error: error.message }, { status: 403, headers: HEADERS });
    return NextResponse.json({ error: "Odoo installation quarantine unavailable" }, { status: 503, headers: HEADERS });
  }
}
