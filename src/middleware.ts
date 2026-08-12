import { NextRequest, NextResponse } from "next/server";
import { verifySession, verifyBackupSession, backupCredentialLive } from "@/lib/adminAuth";

export const config = {
  // Matcher uses two entries so `/admin` (no trailing path) is also gated;
  // `:path*` alone matches /admin/foo and /admin/foo/bar but not bare /admin.
  matcher: ["/admin", "/admin/:path*"],
};

// `backupCredentialLive` (the R4 immediate-revoke DB re-check) moved to
// @/lib/adminAuth so the /api/admin/status route shares the exact same query —
// see that file. Nothing else here changed.

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /admin/login must be reachable without a session, else infinite redirect.
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) {
    return NextResponse.next();
  }

  // Primary path first — pure HMAC, no DB, no new cost (R6).
  const primary = request.cookies.get("admin_session")?.value;
  if (await verifySession(primary)) return NextResponse.next();

  // Backup path — only reached when there is no valid primary session.
  const backupCookie = request.cookies.get("admin_backup_session")?.value;
  const backup = await verifyBackupSession(backupCookie);
  if (backup && (await backupCredentialLive(backup.credId))) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}
