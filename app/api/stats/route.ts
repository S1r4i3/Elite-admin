import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/access";
import { counts, stats } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/stats — dashboard counters; ?counts=1 → sidebar badges only (no rows transferred). */
export async function GET(req: Request) {
  let access;
  try {
    access = await requireAccess();
  } catch (r) {
    return r as Response;
  }
  const onlyCounts = new URL(req.url).searchParams.get("counts") === "1";
  return NextResponse.json({ ok: true, stats: onlyCounts ? await counts(access) : await stats(access) }, { headers: { "cache-control": "private, no-store" } });
}
