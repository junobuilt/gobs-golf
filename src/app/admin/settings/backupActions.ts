"use server";

// Backup Admin PIN — mint / disable / status. Runs in the Node runtime (server
// actions), so `hashBackupPin` (node:crypto scrypt) is available. All DB access
// is via the normal anon Supabase client under the repo's allow-all RLS posture
// (lockdown parked for a future holistic RLS pass — see ROADMAP).

import { supabase } from "@/lib/supabase";
import { hashBackupPin } from "@/lib/backupPin";

const ALLOWED_DAYS = [1, 3, 7] as const;
const DEFAULT_DAYS = 3;

export type BackupPinStatus = {
  active: boolean;
  expiresAt?: string; // ISO; present only when active
};

export type MintBackupPinState =
  | { ok: true; pin: string; expiresAt: string }
  | { ok: false; error: string }
  | null;

/** Revoke every currently-active (unrevoked, unexpired) backup credential. */
async function revokeActive(nowIso: string): Promise<void> {
  await supabase
    .from("admin_backup_pin")
    .update({ revoked_at: nowIso })
    .is("revoked_at", null)
    .gt("expires_at", nowIso);
}

/**
 * Mint a new backup PIN. Validates a 4-digit PIN + a 1/3/7-day duration,
 * supersedes any prior active credential (one active at a time), stores a
 * peppered scrypt hash, and returns the PIN + expiry ONCE for handoff.
 */
export async function mintBackupPin(
  _prev: MintBackupPinState,
  formData: FormData
): Promise<MintBackupPinState> {
  const pin = String(formData.get("pin") ?? "");
  const daysRaw = Number(formData.get("days") ?? DEFAULT_DAYS);

  if (!/^\d{4}$/.test(pin)) {
    return { ok: false, error: "PIN must be exactly 4 digits." };
  }
  const days = (ALLOWED_DAYS as readonly number[]).includes(daysRaw)
    ? daysRaw
    : DEFAULT_DAYS;

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const expiresAtIso = expiresAt.toISOString();

  const pinHash = await hashBackupPin(pin);

  // Supersede prior active, then insert the new credential.
  await revokeActive(nowIso);
  const { error } = await supabase
    .from("admin_backup_pin")
    .insert({ pin_hash: pinHash, expires_at: expiresAtIso });

  if (error) {
    return { ok: false, error: "Could not save the backup PIN. Try again." };
  }
  return { ok: true, pin, expiresAt: expiresAtIso };
}

/** Disable (revoke) the active backup credential. Immediate-revoke is enforced
 *  by the middleware re-check on the next backup-authenticated request. */
export async function disableBackupPin(): Promise<BackupPinStatus> {
  await revokeActive(new Date().toISOString());
  return { active: false };
}

/** Current status for the Settings card: active + expiry, or inactive. */
export async function getBackupPinStatus(): Promise<BackupPinStatus> {
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from("admin_backup_pin")
    .select("expires_at")
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1);

  const row = data?.[0];
  if (!row) return { active: false };
  return { active: true, expiresAt: row.expires_at as string };
}
