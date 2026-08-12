// GET /api/admin/status → { isAdmin: boolean } and NOTHING else.
//
// The tournament scorecard is a PUBLIC route, so middleware (which only matches
// /admin*) never runs on it and the admin-only cookies are httpOnly (client JS
// can't read them). This route lets a client component ask the server "is the
// current request from an admin?" by running the EXACT two checks the /admin
// middleware runs:
//   1. verifySession(admin_session)                          — primary, pure HMAC
//   2. verifyBackupSession(admin_backup_session)             — signature + expiry
//      && backupCredentialLive(credId)                       — R4 immediate-revoke
// It returns ONLY the boolean — no identity, no PIN, no expiry — so a leaked
// response reveals nothing. Fails CLOSED: any error → { isAdmin: false }, and
// the response is never cached (a revoke must take effect on the next load).

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  verifySession,
  verifyBackupSession,
  backupCredentialLive,
} from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

async function computeIsAdmin(): Promise<boolean> {
  try {
    const jar = await cookies();
    // Primary path first — pure HMAC, no DB (mirrors the middleware order).
    if (await verifySession(jar.get("admin_session")?.value)) return true;
    // Backup path — signature + expiry, THEN the per-request live re-check so a
    // revoked/expired credential is denied. (isAdminSession in adminPreview.ts
    // deliberately skips this live check; the Clear feature needs it, so this
    // route is the stricter gate.)
    const backup = await verifyBackupSession(jar.get("admin_backup_session")?.value);
    if (backup && (await backupCredentialLive(backup.credId))) return true;
    return false;
  } catch {
    return false;
  }
}

export async function GET() {
  const isAdmin = await computeIsAdmin();
  return NextResponse.json(
    { isAdmin },
    { headers: { "Cache-Control": "no-store" } },
  );
}
