import { NextResponse, after } from "next/server";
import { findEmployeeByEmail, log } from "@/lib/db";
import { sb, supabaseEnabled } from "@/lib/supabase";

/** Per-instance limiter (fast path) — the database check below covers all instances. */
const hits = new Map<string, number[]>();
function tooMany(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > limit;
}

const FAILED = "Failed sign-in";
const LOCK_WINDOW_MS = 15 * 60_000;
const MAX_FAILED = 8;

/** Failed attempts for this email in the last 15 minutes, across every server instance. */
async function recentFailures(email: string) {
  if (!supabaseEnabled()) return 0;
  const since = new Date(Date.now() - LOCK_WINDOW_MS).toISOString();
  const { count } = await sb().from("admin_logs").select("id", { count: "exact", head: true }).eq("who", email).eq("action", FAILED).gte("created_at", since);
  return count ?? 0;
}
import { createSessionToken, sessionCookieOptions, sessionSecret, SESSION_COOKIE, verifyPassword } from "@/lib/auth";

/** POST /api/auth/login  { email, password } */
export async function POST(req: Request) {
  const { email, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!email || !password) return NextResponse.json({ ok: false, error: "Email and password are required." }, { status: 400 });
  const who = String(email).trim().toLowerCase().slice(0, 200);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const locked = "Too many sign-in attempts. Please wait 15 minutes and try again.";
  if (tooMany(`ip:${ip}`, 30, LOCK_WINDOW_MS) || (await recentFailures(who).catch(() => 0)) >= MAX_FAILED) {
    return NextResponse.json({ ok: false, error: locked }, { status: 429 });
  }

  let employee;
  try {
    employee = await findEmployeeByEmail(email);
  } catch (e) {
    // Configuration problems (missing env vars on the server) — say so instead of a blank 500.
    console.error("[login]", e);
    return NextResponse.json({ ok: false, error: `Server setup problem: ${(e as Error).message}` }, { status: 500 });
  }
  if (!employee || employee.status !== "active" || !(await verifyPassword(password, employee.passwordHash))) {
    after(() => log(who, FAILED, `from ${ip}`));
    return NextResponse.json({ ok: false, error: "Incorrect email or password." }, { status: 401 });
  }

  after(() => log(employee.email, "Signed in")); // don't make the person wait for the log write
  if (!sessionSecret()) {
    return NextResponse.json({ ok: false, error: "Server setup problem: SESSION_SECRET is not set in the environment." }, { status: 500 });
  }
  const res = NextResponse.json({ ok: true, admin: { id: employee.id, name: employee.name, email: employee.email, role: employee.role } });
  res.cookies.set(SESSION_COOKIE, createSessionToken(employee.id, employee.email), sessionCookieOptions);
  return res;
}
