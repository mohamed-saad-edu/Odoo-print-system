import { NextResponse } from "next/server";
import { validateWorkspaceManager } from "../../../../lib/manager-auth";

/** Every workspace tenant invitation operation is Platform Owner-only. */
export async function GET(req: Request) {
  const principal = await validateWorkspaceManager(req);
  if (!principal) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  return NextResponse.json({ error: "Platform Owner required", code: "PLATFORM_OWNER_REQUIRED" }, { status: 403 });
}
export async function POST(req: Request) { return GET(req); }
export async function DELETE(req: Request) { return GET(req); }
