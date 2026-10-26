import { NextResponse } from "next/server";
import { db } from "../../../../db";
import { tenantUsers, users } from "../../../../db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { validateWorkspaceManager } from "../../../../lib/manager-auth";
import { hasManagerPermission } from "../../../../lib/authorization";
import { queryWithTimeout } from "../../../../db/client";
import { clampListLimit } from "../../../../lib/request-limits";

export async function GET(req: Request) {
  const claims = await validateWorkspaceManager(req);
  if (!claims) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  if (!claims?.userId || !hasManagerPermission(claims, "users.read")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const limit = clampListLimit(searchParams.get("limit"), 50, 100);
  const offset = Number(searchParams.get("offset") ?? "0");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
    return NextResponse.json({ error: "Invalid offset" }, { status: 400 });
  }

  const [rows, countRows] = await Promise.all([
    queryWithTimeout(
      () => db
        .select({
          userId: tenantUsers.userId,
          email: users.email,
          role: tenantUsers.role,
          createdAt: tenantUsers.createdAt,
        })
        .from(tenantUsers)
        .innerJoin(users, eq(users.id, tenantUsers.userId))
        .where(eq(tenantUsers.tenantId, claims.tenantId))
        .orderBy(desc(tenantUsers.createdAt), desc(tenantUsers.userId))
        .offset(offset)
        .limit(limit + 1),
      5_000,
      "teamMembersList",
    ),
    queryWithTimeout(
      () => db
        .select({ total: sql<number>`count(*)::int` })
        .from(tenantUsers)
        .where(eq(tenantUsers.tenantId, claims.tenantId)),
      5_000,
      "teamMembersCount",
    ),
  ]);

  return NextResponse.json({
    members: rows.slice(0, limit),
    hasMore: rows.length > limit,
    offset,
    limit,
    total: countRows[0]?.total ?? 0,
  });
}


/** Workspace membership mutations require the separate Platform Owner audience. */
export async function PATCH(_req: Request) {
  return NextResponse.json({ error: "Platform Owner required", code: "PLATFORM_OWNER_REQUIRED" }, { status: 403 });
}
export async function DELETE(_req: Request) {
  return NextResponse.json({ error: "Platform Owner required", code: "PLATFORM_OWNER_REQUIRED" }, { status: 403 });
}
