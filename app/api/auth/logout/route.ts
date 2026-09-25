import { NextResponse } from "next/server";
import { SESSION_COOKIE, currentAdmin } from "@/lib/auth";
import { log } from "@/lib/db";

/** POST /api/auth/logout */
export async function POST() {
  const admin = await currentAdmin();
  if (admin) await log(admin.email, "Signed out");
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

/** GET /api/auth/logout?next=/login — clears a stale session cookie, then redirects. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next");
  const res = NextResponse.redirect(new URL(next && next.startsWith("/") ? next : "/login", url));
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
