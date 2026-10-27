import { NextResponse } from "next/server";
import { db } from "../../../../db";
import { tenantUsers, users } from "../../../../db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { validateWorkspaceManager } from "../../../../lib/manager-auth";
import { hasManagerPermission } from "../../../../lib/authorization";
import { requireActiveTenantInTransaction, TenantSuspendedError, TenantDeletedError } from "../../../../lib/tenant-guard";
import { requireManagerActorInTransaction, ManagerMutationAuthorityChangedError } from "../../../../lib/manager-mutation-authorization";
import { queryWithTimeout } from "../../../../db/client";
import { clampListLimit, parseStrictListOffset } from "../../../../lib/request-limits";
import { platformOwnerRequiredResponse } from "../../../../lib/team-authorization";
import { logError } from "../../../../lib/log";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  const claims = await validateWorkspaceManager(req);
  if (!claims) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });
  if (!claims.userId || !hasManagerPermission(claims, "users.read")) {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403, headers: PRIVATE_HEADERS });
  }

  const { searchParams } = new URL(req.url);
  const limit = clampListLimit(searchParams.get("limit"), 50, 100);
  const offset = parseStrictListOffset(searchParams.get("offset"), 1_000_000);
  if (offset === null) {
    return NextResponse.json({ error: "Invalid offset", code: "INVALID_OFFSET" }, { status: 400, headers: PRIVATE_HEADERS });
  }

  try {
    // Validation at the HTTP boundary is only a preflight. The principal,
    // session and tenant can change before the directory query starts.
    // Keep lifecycle and durable session authority fenced until the last row
    // of the page is read, so a revoked member cannot see colleague emails.
    const [rows, countRows] = await db.transaction(async tx => {
      await requireActiveTenantInTransaction(tx, claims.tenantId);
      await requireManagerActorInTransaction(tx, claims, "users.read");
      const rows = await queryWithTimeout(
        () => tx
          .select({
            userId: tenantUsers.userId,
            email: users.email,
            role: tenantUsers.role,
            platformOwner: sql<boolean>`${users.isPlatformOwner} AND ${users.emailVerifiedAt} IS NOT NULL`,
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
      );
      const countRows = await queryWithTimeout(
        () => tx
          .select({ total: sql<number>`count(*)::int` })
          .from(tenantUsers)
          .where(eq(tenantUsers.tenantId, claims.tenantId)),
        5_000,
        "teamMembersCount",
      );
      return [rows, countRows] as const;
    });

    return NextResponse.json({
      members: rows.slice(0, limit),
      hasMore: rows.length > limit,
      offset,
      limit,
      total: countRows[0]?.total ?? 0,
    }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403, headers: PRIVATE_HEADERS });
    }
    if (error instanceof ManagerMutationAuthorityChangedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: PRIVATE_HEADERS });
    }
    logError("team.members_directory_read_failed", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Directory temporarily unavailable", code: "DIRECTORY_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS });
  }
}

/** Deny write access at the route boundary; 401 still distinguishes an expired session. */
async function denyMemberMutation(req: Request) {
  const claims = await validateWorkspaceManager(req);
  if (!claims?.userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  return platformOwnerRequiredResponse(); // PLATFORM_OWNER_REQUIRED
}
export async function PATCH(req: Request) { return denyMemberMutation(req); }
export async function DELETE(req: Request) { return denyMemberMutation(req); }
