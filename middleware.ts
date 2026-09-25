import { NextResponse, type NextRequest } from "next/server";

/**
 * First gate: bounce anyone without a session cookie to /login.
 * The signature itself is verified in the page layout and in every API route
 * (see lib/auth.ts → requireAdmin), because middleware runs on the Edge runtime
 * where Node's crypto module isn't available.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasCookie = !!req.cookies.get("ebt_admin_session")?.value;

  // Always let /login render. Redirecting it to "/" whenever *a* cookie exists caused an
  // endless / ⇄ /login loop when the cookie was stale (e.g. after SESSION_SECRET changed).
  if (pathname === "/login") return NextResponse.next();
  if (hasCookie) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth/login).*)"],
};
