import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformOwner, PlatformUnauthorizedError } from "../../../../lib/platform-auth";
import { readPlatformDatabase } from "../../../../lib/platform-data-explorer";
import { parseStrictListOffset } from "../../../../lib/request-limits";

export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
const querySchema=z.object({
  table:z.string().regex(/^[a-z][a-z0-9_]{0,90}$/).optional(),
  q:z.string().trim().min(1).max(100).optional(),
  offset:z.number().int().min(0).max(10000),
});
export async function GET(request:Request) {
  try { await requirePlatformOwner(request); }
  catch (error) {
    if (error instanceof PlatformUnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    }
    // A broken auth dependency is NOT an invalid login. Fail closed, visibly.
    return NextResponse.json(
      { error: "Platform authentication temporarily unavailable" },
      { status: 503, headers },
    );
  }
  const url=new URL(request.url);
  const offset = parseStrictListOffset(url.searchParams.get("offset"), 10_000);
  const args=querySchema.safeParse({table:url.searchParams.get("table")??undefined,
    q:url.searchParams.get("q")??undefined,offset});
  if(!args.success) return NextResponse.json({error:"Invalid explorer filters"},{status:400,headers});
  try {
    const result=await readPlatformDatabase({table:args.data.table,search:args.data.q,offset:args.data.offset});
    if(args.data.table && !result.selected) return NextResponse.json({error:"Table unavailable"},{status:404,headers});
    return NextResponse.json(result,{headers});
  } catch { return NextResponse.json({error:"Read-only database explorer unavailable"},{status:503,headers}); }
}
