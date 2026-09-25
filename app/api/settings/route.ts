import { NextResponse } from "next/server";
import { forbidden, requireAccess } from "@/lib/access";
import { getSettings, log, saveSettings } from "@/lib/db";

/** Settings are Super Admin only. */
async function requireAdmin() {
  const a = await requireAccess();
  if (!a.isSuper) throw forbidden();
  return a;
}

export const dynamic = "force-dynamic";

/** GET /api/settings */
export async function GET() {
  try {
    await requireAdmin();
  } catch (r) {
    return r as Response;
  }
  return NextResponse.json({ ok: true, settings: await getSettings() });
}

/** PATCH /api/settings */
export async function PATCH(req: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (r) {
    return r as Response;
  }
  const patch = (await req.json().catch(() => ({}))) as Record<string, string>;
  const settings = await saveSettings(patch);
  await log(admin.email, "Updated settings");
  return NextResponse.json({ ok: true, settings });
}
