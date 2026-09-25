import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/access";
import { stats } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/stats — dashboard counters */
export async function GET() {
  let access;
  try {
    access = await requireAccess();
  } catch (r) {
    return r as Response;
  }
  return NextResponse.json({ ok: true, stats: await stats(access) });
}
