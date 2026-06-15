import { NextRequest, NextResponse } from "next/server";
import { verifySession, verifyBackupSession } from "@/lib/adminAuth";

export const config = {
  // Matcher uses two entries so `/admin` (no trailing path) is also gated;
  // `:path*` alone matches /admin/foo and /admin/foo/bar but not bare /admin.
  matcher: ["/admin", "/admin/:path*"],
};

// Edge-side re-check that a backup credential is still live (R4 immediate-revoke).
// Runs ONLY on the backup path (primary sessions never reach it — R6). Fails
// CLOSED on any error/unreachable DB: an admin gate should deny on doubt.
export async function backupCredentialLive(credId: number): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;

  try {
    const nowIso = new Date().toISOString();
    const q = new URL(`${url}/rest/v1/admin_backup_pin`);
    q.searchParams.set("select", "id");
    q.searchParams.set("id", `eq.${credId}`);
    q.searchParams.set("revoked_at", "is.null");
    q.searchParams.set("expires_at", `gt.${nowIso}`);
    q.searchParams.set("limit", "1");

    const res = await fetch(q.toString(), {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const rows = (await res.json()) as unknown[];
    return Array.isArray(rows) && rows.length === 1;
  } catch {
    return false;
  }
}

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
