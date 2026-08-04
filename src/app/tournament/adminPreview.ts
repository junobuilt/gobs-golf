"use server";

// Admin preview doorway (migration 040 companion). The tournament surfaces are
// player-facing and gate on `is_published`; the ONLY way to reach them for
// testing used to be flipping the tournament Live, which exposes it to the whole
// league. This server action lets an ADMIN (and only an admin) preview an
// unpublished tournament by reusing the SAME auth the /admin middleware uses —
// the signed `admin_session` / `admin_backup_session` cookies via verifySession.
// The cookies are HTTP-only, so a client component can't read them itself; it
// calls this action, which reads them server-side. A player has neither cookie,
// so they always get `false` — `is_published` keeps its single job of gating
// what players see.

import { cookies } from "next/headers";
import { verifySession, verifyBackupSession } from "@/lib/adminAuth";

export async function isAdminSession(): Promise<boolean> {
  // Fail CLOSED: any error (no request scope, missing secret, unreadable cookie)
  // means "not admin", so a player can never slip through and the preview gate
  // simply stays shut. An admin gate should deny on doubt (mirrors middleware).
  try {
    const jar = await cookies();
    // Primary path first (pure HMAC, no DB) — mirrors the middleware order.
    if (await verifySession(jar.get("admin_session")?.value)) return true;
    // Backup credential: signature + expiry check (same as the middleware's
    // Edge-side verify; the per-request live re-check is the middleware's job on
    // the /admin tree itself, not this read-only preview gate).
    const backup = await verifyBackupSession(jar.get("admin_backup_session")?.value);
    return backup != null;
  } catch {
    return false;
  }
}
