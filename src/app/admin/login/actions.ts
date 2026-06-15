"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  signSession,
  signBackupSession,
  timingSafeEqual,
} from "@/lib/adminAuth";
import { verifyBackupPin } from "@/lib/backupPin";
import { supabase } from "@/lib/supabase";

export type VerifyPinState = { error?: string } | null;

const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60;

// Attempt the backup-PIN path (only reached after the primary PIN misses).
// Returns the safe redirect target on success, or null to fall through to the
// generic "Incorrect PIN" error. Reads the single active credential via the
// anon client, scrypt-compares, issues a short-lived backup cookie bound to the
// credential's expiry, and writes an audit row.
async function tryBackupLogin(
  pin: string,
  next: string
): Promise<string | null> {
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from("admin_backup_pin")
    .select("id, pin_hash, expires_at")
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1);

  const row = data?.[0];
  if (!row) return null;

  const ok = await verifyBackupPin(pin, row.pin_hash as string);
  if (!ok) return null;

  const expiresAtMs = new Date(row.expires_at as string).getTime();
  const credId = Number(row.id);
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
