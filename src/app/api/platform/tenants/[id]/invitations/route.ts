import { NextResponse } from "next/server";
import { db } from "../../../../../../db";
import { tenantInvitations } from "../../../../../../db/schema";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { requirePlatformOwner, requirePlatformActorInTransaction } from "../../../../../../lib/platform-auth";
import { assertPlatformTeamOrigin } from "../../../../../../lib/platform-team-security";
import { ManualSubscriptionError } from "../../../../../../lib/manual-subscriptions";
import { manualApiError } from "../../../../../../lib/manual-api-error";
import { generateOpaqueToken, hashToken, normalizeEmail, validEmail } from "../../../../../../lib/password";
import { sendTransactionalEmail, appBaseUrl } from "../../../../../../lib/email";
import { getServerLocale, makeT } from "../../../../../../i18n/server";
import { nanoid } from "../../../../../../lib/nanoid";
import { writeAuditEvent } from "../../../../../../lib/audit";
import { logError } from "../../../../../../lib/log";
import { hasBodyOverLimit } from "../../../../../../lib/request-limits";

type Ctx = { params: Promise<{ id: string }> };
const active = (tenantId: string) => and(
  eq(tenantInvitations.tenantId, tenantId),
  isNull(tenantInvitations.acceptedAt),
  isNull(tenantInvitations.revokedAt),
  gt(tenantInvitations.expiresAt, sql`clock_timestamp()`),
);

export async function GET(req: Request, ctx: Ctx) {
  try {
    await requirePlatformOwner(req);
    const { id } = await ctx.params;
    const rows = await db.select({
      id: tenantInvitations.id, email: tenantInvitations.email,
      expiresAt: tenantInvitations.expiresAt, createdAt: tenantInvitations.createdAt,
    }).from(tenantInvitations).where(active(id))
      .orderBy(desc(tenantInvitations.createdAt)).limit(100);
    return NextResponse.json({ invitations: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return manualApiError(error); }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    assertPlatformTeamOrigin(req);
    if (hasBodyOverLimit(req, 16 * 1024)) throw new ManualSubscriptionError("REQUEST_TOO_LARGE", 413);
    const claims = await requirePlatformOwner(req);
    const { id: tenantId } = await ctx.params;
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ManualSubscriptionError("INVALID_JSON", 400);
    const fields = body as Record<string, unknown>;
    if ("role" in fields) throw new ManualSubscriptionError("ROLE_SELECTION_RETIRED", 400);
    const email = typeof fields.email === "string" ? normalizeEmail(fields.email) : "";
    if (!validEmail(email)) throw new ManualSubscriptionError("INVALID_EMAIL", 400);
    const token = generateOpaqueToken();
    const inviteId = `inv_${nanoid(18)}`;
    await db.transaction(async tx => {
      const tenant = await tx.execute(sql`SELECT id,lifecycle FROM tenants WHERE id=${tenantId} FOR UPDATE`);
      if (tenant.rows[0]?.lifecycle !== "active") throw new ManualSubscriptionError("WORKSPACE_NOT_ACTIVE", 409);
      await requirePlatformActorInTransaction(tx, claims);
      const existing = await tx.query.tenantInvitations.findFirst({
        where: and(active(tenantId), eq(tenantInvitations.email, email)),
        columns: { id: true },
      });
      if (existing) throw new ManualSubscriptionError("INVITATION_ALREADY_EXISTS", 409);
      const alreadyMember = await tx.execute(sql`SELECT 1 FROM tenant_users m
        JOIN users u ON u.id=m.user_id WHERE m.tenant_id=${tenantId} AND u.email=${email} LIMIT 1`);
      if (alreadyMember.rows.length) throw new ManualSubscriptionError("ALREADY_MEMBER", 409);
      await tx.insert(tenantInvitations).values({
        id: inviteId, tenantId, inviterUserId: claims.userId,
        email, role: "admin", tokenHash: await hashToken(token),
        expiresAt: sql`clock_timestamp() + interval '7 days'`,
      });
      await writeAuditEvent({
        tenantId, actorType: "platform", actorId: claims.userId,
        action: "team.invitation.created", resourceType: "tenant_invitation", resourceId: inviteId,
      }, tx);
    });
    const url = `${appBaseUrl(req)}/invite?token=${encodeURIComponent(token)}`;
    try {
      const t = makeT(await getServerLocale());
      await sendTransactionalEmail({
        to: email, subject: t("mail.invite.subject"),
        html: `<p>${t("mail.invite.body")}</p><p><a href="${url}">${t("mail.invite.cta")}</a></p>`,
        text: t("mail.invite.text", { url }),
      });
    } catch (error) {
      logError("platform.invitation_delivery_ambiguous", { error: error instanceof Error ? error.message : "unknown" });
      return NextResponse.json({ error: "Invitation created; delivery unconfirmed", code: "INVITATION_DELIVERY_UNAVAILABLE", id: inviteId }, { status: 503 });
    }
    return NextResponse.json({ ok: true, id: inviteId }, { status: 201 });
  } catch (error) { return manualApiError(error); }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    assertPlatformTeamOrigin(req);
    const claims = await requirePlatformOwner(req);
    const { id: tenantId } = await ctx.params;
    const inviteId = new URL(req.url).searchParams.get("id") ?? "";
    if (!inviteId) throw new ManualSubscriptionError("INVITATION_ID_REQUIRED", 400);
    await db.transaction(async tx => {
      const tenant = await tx.execute(sql`SELECT id FROM tenants WHERE id=${tenantId} FOR UPDATE`);
      if (!tenant.rows.length) throw new ManualSubscriptionError("WORKSPACE_NOT_FOUND", 404);
      await requirePlatformActorInTransaction(tx, claims);
      const revoked = await tx.update(tenantInvitations).set({ revokedAt: sql`clock_timestamp()` }).where(and(
        eq(tenantInvitations.id, inviteId), eq(tenantInvitations.tenantId, tenantId),
        isNull(tenantInvitations.acceptedAt), isNull(tenantInvitations.revokedAt),
      )).returning({ id: tenantInvitations.id });
      if (revoked.length !== 1) throw new ManualSubscriptionError("INVITATION_NOT_FOUND", 404);
      await writeAuditEvent({
        tenantId, actorType: "platform", actorId: claims.userId,
        action: "team.invitation.revoked", resourceType: "tenant_invitation", resourceId: inviteId,
      }, tx);
    });
    return NextResponse.json({ ok: true });
  } catch (error) { return manualApiError(error); }
}
