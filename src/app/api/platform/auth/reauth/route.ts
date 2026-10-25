import { z } from "zod";
import { db } from "../../../../../db";
import { authenticatePlatformOwner, validatePlatformOwner, platformCookieHeader, platformRefreshCookieHeader } from "../../../../../lib/platform-auth";
import { AuthenticationChangedError, rotatePlatformSessionAfterReauthenticationInTransaction } from "../../../../../lib/session-tokens";
import { platformSecurityStatus, PlatformSessionExpiredError } from "../../../../../lib/platform-session-security";
import { assertWorkspaceSecurityOrigin, readWorkspaceSecurityJson, WorkspaceSecurityRequestError } from "../../../../../lib/workspace-session-http";
import { clearLegacySessionCookies } from "../../../../../lib/session-config";
import { clientIpFrom, reserveAuthAttempt, recordAuthSuccess, setRateLimitHeaders } from "../../../../../lib/auth-rate-limit";
import { writeAuditEvent } from "../../../../../lib/audit";
import { logError, logWarn, requestIdFrom } from "../../../../../lib/log";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };
const input = z.object({ password: z.string().min(1).max(4096) }).strict();
function failure(error: unknown): Response {
  if (error instanceof WorkspaceSecurityRequestError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: HEADERS });
  if (error instanceof AuthenticationChangedError || error instanceof PlatformSessionExpiredError) return Response.json({ error: "Your session expired or changed. Sign in again.", code: "SESSION_EXPIRED" }, { status: 401, headers: HEADERS });
  logError("auth.platform_reauthentication.unavailable", { error: "Platform security infrastructure unavailable" });
  return Response.json({ error: "Security verification temporarily unavailable", code: "SECURITY_UNAVAILABLE" }, { status: 503, headers: HEADERS });
}
export async function GET(req: Request) {
  try {
    const claims = await validatePlatformOwner(req);
    if (!claims?.familyId || !claims.sid) throw new PlatformSessionExpiredError();
    return Response.json(await platformSecurityStatus(claims.familyId,claims.userId,claims.sid), { headers: HEADERS });
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    assertWorkspaceSecurityOrigin(req);
    const claims = await validatePlatformOwner(req);
    if (!claims?.familyId || !claims.sid) throw new PlatformSessionExpiredError();
    const parsed = input.safeParse(await readWorkspaceSecurityJson(req));
    if (!parsed.success) throw new WorkspaceSecurityRequestError(400,"INVALID_REQUEST","A password is required.");
    const ip = clientIpFrom(req), account = `platform-reauth:${claims.userId}`;
    const decision = await reserveAuthAttempt(ip,account);
    if (!decision.allowed) {
      const response = Response.json({ error: "Too many attempts. Try again later.", code: "RATE_LIMITED" }, { status: 429, headers: HEADERS });
      if (decision.retryAfterSec) response.headers.set("Retry-After",String(decision.retryAfterSec));
      return setRateLimitHeaders(response,decision);
    }
    const principal = await authenticatePlatformOwner(claims.email,parsed.data.password);
    if (!principal || principal.userId !== claims.userId) {
      // A failed logging sink cannot change the rejected authentication result.
      try {
        logWarn("auth.platform_reauthentication.password_failed", { requestId: requestIdFrom(req), userId: claims.userId });
      } catch { /* Preserve denial if the warning sink is unavailable. */ }
      throw new WorkspaceSecurityRequestError(403,"PASSWORD_CONFIRMATION_FAILED","Password confirmation failed.");
    }
    const result = await db.transaction(async tx => {
      const pair = await rotatePlatformSessionAfterReauthenticationInTransaction(tx,claims,principal.credentialVersion,{ ipAddress: ip,userAgent: req.headers.get("user-agent") });
      const status = await platformSecurityStatus(pair.familyId,claims.userId,pair.refreshTokenId,tx);
      await writeAuditEvent({ tenantId: null,actorType: "platform",actorId: claims.userId,action: "platform.reauthenticated",resourceType: "session",resourceId: pair.familyId },tx);
      return { pair,status };
    });
    await recordAuthSuccess(ip,account).catch(() => undefined);
    const response = Response.json({ ok: true,expiresAt: result.pair.accessExpiresAt.toISOString(),...result.status }, { headers: HEADERS });
    response.headers.append("Set-Cookie",platformCookieHeader(result.pair.accessToken,result.pair.accessExpiresAt));
    response.headers.append("Set-Cookie",platformRefreshCookieHeader(result.pair.refreshToken,result.pair.refreshExpiresAt));
    clearLegacySessionCookies(response.headers,"platform");
    return setRateLimitHeaders(response,decision);
  } catch (error) { return failure(error); }
}
