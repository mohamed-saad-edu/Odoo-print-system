import { NextResponse } from "next/server";
import { db } from "../../../../db";
import { tenantInvitations } from "../../../../db/schema";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { validateWorkspaceManager } from "../../../../lib/manager-auth";
import { hasManagerPermission } from "../../../../lib/authorization";
import { queryWithTimeout } from "../../../../db/client";
import { clampListLimit } from "../../../../lib/request-limits";

/** Restore the team directory's read-only pending invitations. Invite tokens
 * and mutations remain accessible only through separately authenticated Platform Owner APIs. */
export async function GET(req: Request) {
  const claims = await validateWorkspaceManager(req);
  if (!claims?.userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  if (!hasManagerPermission(claims, "users.read")) {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const limit = clampListLimit(searchParams.get("limit"), 50, 100);
  const offset = Number(searchParams.get("offset") ?? "0");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
    return NextResponse.json({ error: "Invalid offset", code: "INVALID_OFFSET" }, { status: 400 });
  }
  const visible = and(
    eq(tenantInvitations.tenantId, claims.tenantId),
    isNull(tenantInvitations.acceptedAt),
    isNull(tenantInvitations.revokedAt),
    gt(tenantInvitations.expiresAt, sql`clock_timestamp()`),
  );
  const [rows, countRows] = await Promise.all([
    queryWithTimeout(() => db.select({
      id: tenantInvitations.id, email: tenantInvitations.email,
      expiresAt: tenantInvitations.expiresAt, createdAt: tenantInvitations.createdAt,
    }).from(tenantInvitations).where(visible)
      .orderBy(desc(tenantInvitations.createdAt), desc(tenantInvitations.id))
      .offset(offset).limit(limit + 1), 5_000, "teamInvitationsList"),
    queryWithTimeout(() => db.select({ total: sql<number>`count(*)::int` })
      .from(tenantInvitations).where(visible), 5_000, "teamInvitationsCount"),
  ]);
  return NextResponse.json({
    invitations: rows.slice(0, limit), hasMore: rows.length > limit,
    offset, limit, total: countRows[0]?.total ?? 0,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

/** Workspace credentials can never grant invitation write authority, even for role=owner. */
async function denyWorkspaceMutation(req: Request) {
  const claims = await validateWorkspaceManager(req);
  if (!claims?.userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  return NextResponse.json({ error: "Platform Owner required", code: "PLATFORM_OWNER_REQUIRED" }, { status: 403 });
}
export async function POST(req: Request) { return denyWorkspaceMutation(req); }
export async function DELETE(req: Request) { return denyWorkspaceMutation(req); }
