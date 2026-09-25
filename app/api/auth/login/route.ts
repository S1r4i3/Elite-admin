import { NextResponse } from "next/server";
import { findEmployeeByEmail, log } from "@/lib/db";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE, verifyPassword } from "@/lib/auth";

/** POST /api/auth/login  { email, password } */
export async function POST(req: Request) {
  const { email, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!email || !password) return NextResponse.json({ ok: false, error: "Email and password are required." }, { status: 400 });

  const employee = await findEmployeeByEmail(email);
  if (!employee || employee.status !== "active" || !(await verifyPassword(password, employee.passwordHash))) {
    return NextResponse.json({ ok: false, error: "Incorrect email or password." }, { status: 401 });
  }

  await log(employee.email, "Signed in");
  const res = NextResponse.json({ ok: true, admin: { id: employee.id, name: employee.name, email: employee.email, role: employee.role } });
  res.cookies.set(SESSION_COOKIE, createSessionToken(employee.id, employee.email), sessionCookieOptions);
  return res;
}
