import { requireWorkspaceSecurityClaims, workspaceSecurityErrorResponse, WORKSPACE_SECURITY_HEADERS } from "../../../../../lib/workspace-session-http";
import { readWorkspaceSessionState, workspaceSecurityStatus, WorkspaceSessionExpiredError } from "../../../../../lib/workspace-session-security";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const claims = await requireWorkspaceSecurityClaims(req);
    const state = await readWorkspaceSessionState({ ...claims, familyId: claims.familyId!, kind: claims.kind === "customer" ? "customer" : "manager" });
    if (!state) throw new WorkspaceSessionExpiredError();
    return Response.json(workspaceSecurityStatus(state), { headers: WORKSPACE_SECURITY_HEADERS });
  } catch (error) { return workspaceSecurityErrorResponse(error); }
}
