import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../../../../db";
import { users } from "../../../../../db/schema";
import { authenticateCustomer, getManagerUsername, verifyManagerPassword } from "../../../../../lib/manager-auth";
import { environmentManagerCredentialVersion } from "../../../../../lib/session-credentials";
import { accessCookieHeader, refreshCookieHeader, rotateWorkspaceSessionAfterReauthenticationInTransaction } from "../../../../../lib/session-tokens";
import { clearLegacySessionCookies } from "../../../../../lib/session-config";
import { clientIpFrom, reserveAuthAttempt, recordAuthSuccess, setRateLimitHeaders } from "../../../../../lib/auth-rate-limit";
import { readWorkspaceSessionState, workspaceSecurityStatus, WorkspaceSessionExpiredError } from "../../../../../lib/workspace-session-security";
import { assertWorkspaceSecurityOrigin, readWorkspaceSecurityJson, requireWorkspaceSecurityClaims,
  workspaceSecurityErrorResponse, WorkspaceSecurityRequestError, WORKSPACE_SECURITY_HEADERS } from "../../../../../lib/workspace-session-http";
import { writeAuditEvent } from "../../../../../lib/audit";
import { logWarn, requestIdFrom } from "../../../../../lib/log";

export const dynamic = "force-dynamic";
const inputSchema = z.object({ password: z.string().min(1).max(4096) }).strict();

export async function POST(req: Request) {
  try {
    assertWorkspaceSecurityOrigin(req);
    const claims = await requireWorkspaceSecurityClaims(req);
    const parsed = inputSchema.safeParse(await readWorkspaceSecurityJson(req));
    if (!parsed.success) throw new WorkspaceSecurityRequestError(400, "INVALID_REQUEST", "A password is required.");
    const ip = clientIpFrom(req);
    const accountKey = `workspace-reauth:${claims.userId ?? `environment:${claims.tenantId}`}`;
    const decision = await reserveAuthAttempt(ip, accountKey);
    if (!decision.allowed) return setRateLimitHeaders(Response.json({ error: "Too many attempts. Try again later.", code: "RATE_LIMITED" }, {
      status: 429, headers: WORKSPACE_SECURITY_HEADERS,
    }), decision);
    let proof: string | null = null;
    if (claims.userId) {
      const account = await db.query.users.findFirst({ where: eq(users.id, claims.userId), columns: { email: true } });
      const identity = account ? await authenticateCustomer(account.email, parsed.data.password) : null;
      if (identity?.userId === claims.userId) proof = identity.credentialVersion;
    } else {
      const username = getManagerUsername();
      if (username && await verifyManagerPassword(username, parsed.data.password)) proof = environmentManagerCredentialVersion(claims.tenantId);
    }
    if (!proof) {
      // A failed logging sink cannot change the rejected authentication result.
      try {
        logWarn("auth.workspace_reauthentication.password_failed", {
          requestId: requestIdFrom(req), tenantId: claims.tenantId, userId: claims.userId ?? "environment-manager",
        });
      } catch { /* Preserve denial if the warning sink is unavailable. */ }
      throw new WorkspaceSecurityRequestError(403, "PASSWORD_CONFIRMATION_FAILED", "Password confirmation failed.");
    }
    const kind = claims.kind === "customer" ? "customer" : "manager";
    const outcome = await db.transaction(async tx => {
      const pair = await rotateWorkspaceSessionAfterReauthenticationInTransaction(tx, claims, proof, { ipAddress: ip, userAgent: req.headers.get("user-agent") });
      const state = await readWorkspaceSessionState({ familyId: pair.familyId, kind, tenantId: claims.tenantId, userId: claims.userId, sid: pair.refreshTokenId, role: claims.role }, tx);
      if (!state) throw new WorkspaceSessionExpiredError();
      await writeAuditEvent({ tenantId: claims.tenantId, actorType: "user", actorId: claims.userId ?? "environment-manager",
        action: "auth.workspace.reauthenticated", resourceType: "session", resourceId: pair.familyId, metadata: { kind } }, tx);
      return { pair, status: workspaceSecurityStatus(state) };
    });
    await recordAuthSuccess(ip, accountKey).catch(() => undefined);
    // Only deadlines enter JSON. Credentials remain in the appropriate
    // HttpOnly cookies, including when both human session kinds are present.
    const response = Response.json({ ok: true, expiresAt: outcome.pair.accessExpiresAt.toISOString(), ...outcome.status }, { headers: WORKSPACE_SECURITY_HEADERS });
    response.headers.append("Set-Cookie", accessCookieHeader(kind, outcome.pair.accessToken, outcome.pair.accessExpiresAt));
    response.headers.append("Set-Cookie", refreshCookieHeader(kind, outcome.pair.refreshToken, outcome.pair.refreshExpiresAt));
    clearLegacySessionCookies(response.headers, kind);
    return response;
  } catch (error) {
    return workspaceSecurityErrorResponse(error);
  }
}
