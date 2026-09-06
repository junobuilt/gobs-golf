"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  signSession,
  signBackupSession,
  timingSafeEqual,
} from "@/lib/adminAuth";
import { resolveActiveBackupCredential } from "@/lib/backupCredentials";
import { supabase } from "@/lib/supabase";

export type VerifyPinState = { error?: string } | null;

const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60;

// Attempt the backup-PIN path (only reached after the primary PIN misses).
// Returns the safe redirect target on success, or null to fall through to the
// generic "Incorrect PIN" error. Resolves the entered PIN against EVERY active
// credential (v2 — several named holders at once; see backupCredentials.ts),
// issues a short-lived backup cookie bound to the MATCHING credential's expiry,
// and writes an audit row against that same credential.
async function tryBackupLogin(
  pin: string,
  next: string
): Promise<string | null> {
  const match = await resolveActiveBackupCredential(pin);
  if (!match) return null;

  const { credId, expiresAtMs } = match;
  const session = await signBackupSession(credId, expiresAtMs);
  if (!session) return null;

  // R3: the cookie cannot outlive the credential — bound to seconds-until-expiry
  // (and never beyond the 90-day primary ceiling).
  const secondsUntilExpiry = Math.floor((expiresAtMs - Date.now()) / 1000);
  if (secondsUntilExpiry <= 0) return null;
  const maxAge = Math.min(NINETY_DAYS_SECONDS, secondsUntilExpiry);

  const cookieStore = await cookies();
  cookieStore.set("admin_backup_session", session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });

  // R5: audit the backup login (best-effort — never block access on a log write).
  try {
    const h = await headers();
    await supabase.from("admin_backup_audit").insert({
      credential_id: credId,
      ip: h.get("x-forwarded-for"),
      user_agent: h.get("user-agent"),
    });
  } catch {
    /* audit is best-effort */
  }

  return next;
}

function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/admin";
  if (!raw.startsWith("/")) return "/admin";
  if (raw.startsWith("//")) return "/admin";
  return raw;
}

export async function verifyPin(
  _prevState: VerifyPinState,
  formData: FormData
): Promise<VerifyPinState> {
  const pin = String(formData.get("pin") ?? "");
  const next = String(formData.get("next") ?? "");

  const safeNext = safeNextPath(next);

  // ── Primary PIN path (byte-for-byte unchanged; R6) ─────────────────────────
  const expected = process.env.ADMIN_PIN ?? "";
  if (!expected) {
    console.error("ADMIN_PIN is not set — refusing all PIN entries.");
    return { error: "Incorrect PIN" };
  }
  if (timingSafeEqual(pin, expected)) {
    const session = await signSession();
    if (!session) return { error: "Incorrect PIN" };

    const cookieStore = await cookies();
    cookieStore.set("admin_session", session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 90 * 24 * 60 * 60,
    });

    redirect(safeNext);
  }

  // ── Backup PIN path (only on primary miss) ─────────────────────────────────
  const backupNext = await tryBackupLogin(pin, safeNext);
  if (backupNext) redirect(backupNext);

  return { error: "Incorrect PIN" };
}
