import { sql } from "drizzle-orm";
import type { DbTx } from "../db";
import type { ConsoleAuth } from "./console-auth";
import { requireActiveTenantInTransaction } from "./tenant-guard";
import { requireManagerActorInTransaction } from "./manager-mutation-authorization";
import type { ManagerPermission } from "./authorization";

export class ConsoleAgentAuthorityRevokedError extends Error {
  readonly code = "UNAUTHORIZED";
  readonly status = 401;
  constructor() {
    super("Agent authorization has changed. Re-pair the Agent.");
    this.name = "ConsoleAgentAuthorityRevokedError";
  }
}

/**
 * A successful HTTP authentication is only a preflight: its tenant, session,
 * Agent lifecycle and secret may change before a later fleet SELECT.
 *
 * The tenant lock is first (same as other Gateway readers/writers). For a
 * manager the shared current-session guard locks role and revocation evidence.
 * For an Agent the current ID, tenant, hashed secret and lifecycle are checked
 * under a row lock; its old bearer token cannot enumerate after re-pairing,
 * rotation, disablement or removal. Keep this transaction alive through the
 * caller's fleet query, then release the row locks.
 */
export async function requireConsoleReadAuthorityInTransaction(
  tx: DbTx,
  auth: ConsoleAuth,
  permission: ManagerPermission,
): Promise<void> {
  const tenantId = auth.kind === "manager" ? auth.claims.tenantId : auth.agent.tenantId;
  await requireActiveTenantInTransaction(tx, tenantId);
  if (auth.kind === "manager") {
    await requireManagerActorInTransaction(tx, auth.claims, permission);
    return;
  }
  const row = await tx.execute(sql`
    SELECT id FROM agents
    WHERE id = ${auth.agent.id} AND tenant_id = ${auth.agent.tenantId}
      AND secret = ${auth.agent.secret} AND lifecycle = 'active'
    FOR SHARE
  `);
  if (row.rows.length !== 1) throw new ConsoleAgentAuthorityRevokedError();
}
