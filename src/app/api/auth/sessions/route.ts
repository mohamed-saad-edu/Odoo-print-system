import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateCustomer, validateWorkspaceManager } from "../../../../lib/manager-auth";
import { db } from "../../../../db";
import { users } from "../../../../db/schema";
import { eq } from "drizzle-orm";
import { listOwnSessions, revokeOwnSessions, SessionInventoryRequestError, PlatformSessionStepUpRequiredError } from "../../../../lib/session-inventory";
import { validatePlatformOwner, clearPlatformCookieHeader, clearPlatformRefreshCookieHeader } from "../../../../lib/platform-auth";
import { assertWorkspaceSecurityOrigin, WorkspaceSecurityRequestError } from "../../../../lib/workspace-session-http";
import { ManagerMutationAuthorityChangedError, requireManagerActorInTransaction } from "../../../../lib/manager-mutation-authorization";
import { requireActiveTenantInTransaction, TenantSuspendedError, TenantDeletedError } from "../../../../lib/tenant-guard";
import { AuthenticationChangedError, accessCookieHeader, refreshCookieHeader, clearAccessCookieHeader, clearRefreshCookieHeader } from "../../../../lib/session-tokens";
import { clearLegacySessionCookies } from "../../../../lib/session-config";
import { hasBodyOverLimit } from "../../../../lib/request-limits";
import { clientIpFrom, recordAuthSuccess, reserveAuthAttempt } from "../../../../lib/auth-rate-limit";
import { WorkspaceSessionExpiredError, workspacePolicyResponse } from "../../../../lib/workspace-session-security";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };
const inputSchema = z.object({ action: z.enum(["revoke", "revoke_others", "revoke_all"]), id: z.string().max(150).optional(), password: z.string().min(1).max(4096) }).strict();
// A valid 4096-character password may need six JSON bytes per character.
const BODY_LIMIT = 32 * 1024;

export async function GET(req: Request) {
  try {
    const claims = await validateWorkspaceManager(req);
    if (!claims?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
    const cursors = new URL(req.url).searchParams.getAll("cursor");
    if (cursors.length > 1) throw new SessionInventoryRequestError();
    const snapshot = await db.transaction(async tx => {
      await requireActiveTenantInTransaction(tx, claims.tenantId);
      await requireManagerActorInTransaction(tx, claims, "tenant.read");
      return listOwnSessions({ scope: "workspace", claims }, cursors[0], tx);
    });
    return NextResponse.json(snapshot, { headers: HEADERS });
  } catch (error) {
    if (error instanceof SessionInventoryRequestError) return NextResponse.json({ error: error.message, code: "INVALID_SESSION_CURSOR" }, { status: 400, headers: HEADERS });
    if (error instanceof WorkspaceSessionExpiredError) return workspacePolicyResponse(error);
    if (error instanceof ManagerMutationAuthorityChangedError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: HEADERS });
    if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: HEADERS });
    return NextResponse.json({ error: "Session inventory temporarily unavailable" }, { status: 503, headers: HEADERS });
  }
}

export async function POST(req: Request) {
  try {
    assertWorkspaceSecurityOrigin(req);
    const claims = await validateWorkspaceManager(req);
    if (!claims?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
    if (hasBodyOverLimit(req, BODY_LIMIT)) return NextResponse.json({ error: "Request too large" }, { status: 413, headers: HEADERS });
    const raw = await req.text();
    if (Buffer.byteLength(raw) > BODY_LIMIT) return NextResponse.json({ error: "Request too large" }, { status: 413, headers: HEADERS });
    let json: unknown;
    try { json = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: HEADERS }); }
    const parsed = inputSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: HEADERS });
    const decision = await reserveAuthAttempt(clientIpFrom(req), `session-reauth:${claims.userId}`);
    if (!decision.allowed) return NextResponse.json({ error: "Too many attempts" }, { status: 429, headers: HEADERS });
    const account = await db.query.users.findFirst({ where: eq(users.id, claims.userId), columns: { email: true } });
    const principal = account ? await authenticateCustomer(account.email, parsed.data.password) : null;
    if (!principal || principal.userId !== claims.userId) return NextResponse.json({ error: "Password confirmation failed", code: "PASSWORD_REQUIRED" }, { status: 401, headers: HEADERS });
    const platformClaims = await validatePlatformOwner(req);
    const result = await revokeOwnSessions({ scope: "workspace", claims, platformClaims }, parsed.data.action, parsed.data.id, principal.credentialVersion,
      { ipAddress: clientIpFrom(req), userAgent: req.headers.get("user-agent") });
    await recordAuthSuccess(clientIpFrom(req), `session-reauth:${claims.userId}`).catch(() => undefined);
    if (!result.found) return NextResponse.json({ error: "Session not found" }, { status: 404, headers: HEADERS });
    // Internal rotation material must never enter the browser-renderer JSON.
    const response = NextResponse.json({ ok: true, found: result.found, revoked: result.revoked, signedOut: result.signedOut }, { headers: HEADERS });
    if (result.signedOut) {
      const kind = claims.kind === "customer" ? "customer" : "manager";
      response.headers.append("Set-Cookie", clearAccessCookieHeader(kind));
      response.headers.append("Set-Cookie", clearRefreshCookieHeader(kind));
    }
    if (result.clearPlatformCookie) {
      response.headers.append("Set-Cookie", clearPlatformCookieHeader());
      response.headers.append("Set-Cookie", clearPlatformRefreshCookieHeader());
    }
    if (result.rotation) {
      const { kind, pair } = result.rotation;
      response.headers.append("Set-Cookie", accessCookieHeader(kind, pair.accessToken, pair.accessExpiresAt));
      response.headers.append("Set-Cookie", refreshCookieHeader(kind, pair.refreshToken, pair.refreshExpiresAt));
      clearLegacySessionCookies(response.headers, kind);
    }
    return response;
  } catch (error) {
    if (error instanceof PlatformSessionStepUpRequiredError) return NextResponse.json({ error: error.message, code: error.code, reauthenticationUrl: "/platform/security" }, { status: 403, headers: HEADERS });
    if (error instanceof WorkspaceSessionExpiredError) return workspacePolicyResponse(error);
    if (error instanceof WorkspaceSecurityRequestError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: HEADERS });
    if (error instanceof ManagerMutationAuthorityChangedError) return error.response();
    if (error instanceof AuthenticationChangedError) return NextResponse.json({ error: "Authentication changed. Sign in again." }, { status: 401, headers: HEADERS });
    return NextResponse.json({ error: "Session revocation temporarily unavailable" }, { status: 503, headers: HEADERS });
  }
}
