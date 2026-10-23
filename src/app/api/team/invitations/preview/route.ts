import { NextResponse } from "next/server";
import { db } from "../../../../../db";
import { tenants } from "../../../../../db/schema";
import { eq } from "drizzle-orm";
import { findActiveInvitation } from "../../../../../lib/invitation-join";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
/** Bearer link reveals ONLY its invited mailbox and destination, never users,
 * password state, tokens, sessions or any other tenant's records. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const invitation = await findActiveInvitation(token);
  if (!invitation) return NextResponse.json({ error: "Invitation is invalid or expired" }, { status: 404, headers });
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, invitation.tenantId),
    columns: { name: true, lifecycle: true },
  });
  if (!tenant || tenant.lifecycle !== "active")
    return NextResponse.json({ error: "Workspace unavailable" }, { status: 409, headers });
  return NextResponse.json({
    workspaceName: tenant.name,
    email: invitation.email,
    role: invitation.role,
  }, { headers });
}
