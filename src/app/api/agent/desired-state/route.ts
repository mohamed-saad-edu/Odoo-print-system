import { db } from "../../../../db";
import { sql } from "drizzle-orm";
import { requireActiveTenantInTransaction } from "../../../../lib/tenant-guard";
import { validateAgent } from "../../../../lib/agent-auth";
import { getDesiredPrinterPage } from "../../../../lib/desired-state-page";
import { logError } from "../../../../lib/log";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const agent = await validateAgent(req.headers.get("authorization"));
  if (!agent) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const cursor = new URL(req.url).searchParams.get("after") ?? undefined;
  try {
    const page = await db.transaction(async (tx) => {
      await requireActiveTenantInTransaction(tx, agent.tenantId);
      const credential = await tx.execute(sql`SELECT secret FROM agents
        WHERE id = ${agent.id} AND tenant_id = ${agent.tenantId} AND lifecycle = 'active' FOR SHARE`);
      if (!agent.secret || credential.rows[0]?.secret !== agent.secret) return null;
      return getDesiredPrinterPage(agent.tenantId, agent.id, cursor, options => tx.query.printers.findMany(options));
    });
    if (!page) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return Response.json({ success: true, agentId: agent.id, desiredState: page.items, desiredStateNextCursor: page.nextCursor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && /cursor|beforeId/i.test(error.message)) return Response.json({ error: "Invalid desired-state cursor" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    logError("agent.desired_state.failed", { agentId: agent.id, error });
    return Response.json({ error: "Desired-state read unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
