import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/adminAuth";

export const config = {
  // Matcher uses two entries so `/admin` (no trailing path) is also gated;
  // `:path*` alone matches /admin/foo and /admin/foo/bar but not bare /admin.
  matcher: ["/admin", "/admin/:path*"],
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /admin/login must be reachable without a session, else infinite redirect.
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get("admin_session")?.value;
  const ok = await verifySession(cookie);
  if (ok) return NextResponse.next();

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}
