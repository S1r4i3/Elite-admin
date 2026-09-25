import { NextResponse } from "next/server";
import { findEmployeeByEmail, log } from "@/lib/db";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE, verifyPassword } from "@/lib/auth";

/** POST /api/auth/login  { email, password } */
export async function POST(req: Request) {
  const { email, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!email || !password) return NextResponse.json({ ok: false, error: "Email and password are required." }, { status: 400 });

  let employee;
  try {
    employee = await findEmployeeByEmail(email);
  } catch (e) {
    // Configuration problems (missing env vars on the server) — say so instead of a blank 500.
    console.error("[login]", e);
    return NextResponse.json({ ok: false, error: `Server setup problem: ${(e as Error).message}` }, { status: 500 });
  }
  if (!employee || employee.status !== "active" || !(await verifyPassword(password, employee.passwordHash))) {
    return NextResponse.json({ ok: false, error: "Incorrect email or password." }, { status: 401 });
  }

  await log(employee.email, "Signed in");
  if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    return NextResponse.json({ ok: false, error: "Server setup problem: SESSION_SECRET is not set in the environment." }, { status: 500 });
  }
  const res = NextResponse.json({ ok: true, admin: { id: employee.id, name: employee.name, email: employee.email, role: employee.role } });
  res.cookies.set(SESSION_COOKIE, createSessionToken(employee.id, employee.email), sessionCookieOptions);
  return res;
}
