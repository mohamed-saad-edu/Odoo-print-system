import { NextResponse } from "next/server";
import { z } from "zod";
import { isPlatformActionConfirmed, platformActionReason } from "../../../../../lib/platform-action-confirmation";
import { requirePlatformOwner, PlatformUnauthorizedError, PlatformMutationAuthorityChangedError } from "../../../../../lib/platform-auth";
import { hasBodyOverLimit } from "../../../../../lib/request-limits";
import { removeFleetItem } from "../../../../../lib/platform-fleet-deletion";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };
const schema = z.object({
  kind: z.enum(["agents", "printers"]),
  tenantId: z.string().trim().min(1).max(120),
  id: z.string().trim().min(1).max(150),
  expectedLifecycle: z.enum(["active", "disabled", "retired"]),
  // Native modal confirmation: no ID transcription or minimum reason length.
  confirmed: z.literal(true).optional(),
  confirmId: z.string().trim().min(1).max(150).optional(), // legacy clients
  reason: z.string().trim().max(500).optional(),
}).strict();

export async function POST(req: Request) {
  let actor;
  try { actor = await requirePlatformOwner(req); }
  catch (error) {
    return NextResponse.json({ error: error instanceof PlatformUnauthorizedError ? "Unauthorized" : "Platform authentication temporarily unavailable" },
      { status: error instanceof PlatformUnauthorizedError ? 401 : 503, headers: HEADERS });
  }
  if (hasBodyOverLimit(req, 4 * 1024)) return NextResponse.json({ error: "Request too large" }, { status: 413, headers: HEADERS });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isPlatformActionConfirmed(parsed.data, parsed.data.id))
    return NextResponse.json({ error: "Confirm device removal" }, { status: 400, headers: HEADERS });
  try {
    const result = await removeFleetItem({ ...parsed.data, reason: platformActionReason(parsed.data.reason, "device removal"), actor });
    return NextResponse.json(result, { status: result.status, headers: HEADERS });
  } catch (error) {
    if (error instanceof PlatformMutationAuthorityChangedError) return NextResponse.json({ error: error.message }, { status: 403, headers: HEADERS });
    return NextResponse.json({ error: "Device removal unavailable" }, { status: 503, headers: HEADERS });
  }
}
