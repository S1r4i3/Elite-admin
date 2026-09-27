import "server-only";
import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHmac } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SESSION_COOKIE = "ebt_admin_session";
const MAX_AGE = 60 * 60 * 8; // 8 hours

/**
 * Key that signs the admin session cookie.
 * SESSION_SECRET is preferred. If it's missing on the host, derive a stable server-only
 * secret from the Supabase service key (never sent to the browser), so a forgotten
 * env var can't lock every admin out.
 */
export function sessionSecret(): string | null {
  const s = process.env.SESSION_SECRET?.trim();
  if (s && s.length >= 16) return s;
  const k = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();
  if (k) return createHmac("sha256", k).update("ebt-admin-session-v1").digest("hex");
  return process.env.NODE_ENV === "production" ? null : "dev-only-insecure-secret";
}

function secret() {
  const s = sessionSecret();
  if (!s) throw new Error("SESSION_SECRET must be set in production");
  return s;
}

/* ── Passwords (scrypt) ─────────────────────────────────── */

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored?: string | null) {
  if (!stored) return false;
  const [algo, saltHex, hashHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/* ── Session cookie: <employeeId>.<email>.<expiry>.<hmac> ─ */

const sign = (data: string) => createHmac("sha256", secret()).update(data).digest("hex");

export function createSessionToken(employeeId: string, email: string) {
  const payload = `${employeeId}|${email}|${Date.now() + MAX_AGE * 1000}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

export function readSessionToken(token?: string | null): { id: string; email: string } | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  let payload: string;
  try {
    payload = Buffer.from(body, "base64url").toString();
  } catch {
    return null;
  }
  const expected = sign(payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const [id, email, exp] = payload.split("|");
  if (!id || !exp || Number(exp) < Date.now()) return null;
  return { id, email };
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE,
};

/** The signed-in admin for this request, or null. */
export async function currentAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return readSessionToken(token);
}

/** Throws a 401 Response when the request has no valid session. */
export async function requireAdmin() {
  const admin = await currentAdmin();
  if (!admin) throw new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  return admin;
}
