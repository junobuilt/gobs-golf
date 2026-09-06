"use server";

// Backup Admin PIN v2 — assign / list / revoke, with NAMED HOLDERS.
//
// v1 (H9) allowed ONE active credential: minting superseded the previous one.
// v2 lets several named people hold a PIN simultaneously, each with its own
// calendar expiry, so the admin sees exactly who has access and can remove any
// one of them individually. Minting therefore NO LONGER REVOKES anything — that
// removal is the point of this version (see migration 043).
//
// Runs in the Node runtime (server actions), so `hashBackupPin` /
// `verifyBackupPin` (node:crypto scrypt) are available. All DB access is via the
// normal anon Supabase client under the repo's allow-all RLS posture (lockdown
// parked for a future holistic RLS pass — TD34).
//
// NO PIN OR HASH EVER LEAVES THIS MODULE toward the browser except the one-time
// reveal of the plaintext PIN the admin just chose, returned by mintBackupPin.
// listBackupPins never selects pin_hash.

import { supabase } from "@/lib/supabase";
import { hashBackupPin, verifyBackupPin } from "@/lib/backupPin";
import {
  todayVancouver,
  endOfDayVancouverISO,
  addYearsISO,
  isValidISODate,
  formatLeagueDate,
} from "@/lib/date";

/** One active credential as the Settings list renders it. Never carries a hash. */
export type BackupPinHolder = {
  id: number;
  /** Snapshot of the holder's name at mint time. NULL = pre-upgrade credential. */
  holderName: string | null;
  playerId: number | null;
  expiresAt: string; // ISO
  createdAt: string; // ISO
};

export type MintBackupPinState =
  | { ok: true; pin: string; holderName: string; expiresAt: string }
  | { ok: false; error: string }
  | null;

type ActiveRow = {
  id: number;
  pin_hash: string;
  player_id: number | null;
  holder_name: string | null;
  expires_at: string;
};

/** Every credential that is neither revoked nor expired. */
async function loadActive(): Promise<ActiveRow[]> {
  const { data, error } = await supabase
    .from("admin_backup_pin")
    .select("id, pin_hash, player_id, holder_name, expires_at")
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  if (error || !data) return [];
  return data as ActiveRow[];
}

/**
 * Assign a backup PIN to a named player, expiring at the end of the chosen
 * calendar date in Vancouver.
 *
 * Rejects: a past date, a date more than one year out, a malformed date, a
 * non-4-digit PIN, a player who is missing or not on the active roster, a PIN
 * that collides with any currently-active credential, and a player who already
 * holds one. Does NOT revoke or supersede anything.
 */
export async function mintBackupPin(
  _prev: MintBackupPinState,
  formData: FormData
): Promise<MintBackupPinState> {
  const pin = String(formData.get("pin") ?? "");
  const playerIdRaw = String(formData.get("player_id") ?? "");
  const expiresOn = String(formData.get("expires_on") ?? "");

  if (!/^\d{4}$/.test(pin)) {
    return { ok: false, error: "PIN must be exactly 4 digits." };
  }

  const playerId = Number(playerIdRaw);
  if (!playerIdRaw || !Number.isInteger(playerId)) {
    return { ok: false, error: "Choose who this PIN is for." };
  }

  // ── Expiry: resolve to END OF DAY in Vancouver, so a PIN assigned for
  // "August 29" works all day on August 29 at the course. ────────────────────
  if (!isValidISODate(expiresOn)) {
    return { ok: false, error: "Choose an expiry date." };
  }
  const expiresAtIso = endOfDayVancouverISO(expiresOn);
  if (!expiresAtIso) {
    return { ok: false, error: "Choose an expiry date." };
  }
  if (new Date(expiresAtIso).getTime() <= Date.now()) {
    // Today is allowed (its end-of-day is still ahead); only genuinely past
    // dates land here.
    return { ok: false, error: "That date has already passed." };
  }
  const latest = addYearsISO(todayVancouver(), 1);
  if (expiresOn > latest) {
    return { ok: false, error: "Pick a date within the next year." };
  }

  // ── Player must be on the active roster. ───────────────────────────────────
  const { data: playerRows, error: playerErr } = await supabase
    .from("players")
    .select("id, full_name, is_active")
    .eq("id", playerId)
    .limit(1);

  if (playerErr) {
    return { ok: false, error: "Could not save the PIN. Try again." };
  }
  const player = playerRows?.[0] as
    | { id: number; full_name: string; is_active: boolean }
    | undefined;
  if (!player || !player.is_active) {
    return { ok: false, error: "That player is not on the active roster." };
  }
  const holderName = player.full_name;

  const active = await loadActive();

  // ── One person, one PIN. Without this the admin can silently issue a second
  // PIN to the same person, and removing one leaves them still able to log in —
  // the exact confusion this feature exists to eliminate. The pre-upgrade
  // credential has a NULL player_id and so never triggers this. ──────────────
  const existing = active.find((r) => r.player_id === playerId);
  if (existing) {
    return {
      ok: false,
      error: `${holderName} already has a PIN (expires ${formatLeagueDate(
        existing.expires_at
      )}). Remove it first.`,
    };
  }

  // ── PIN collision. The hash is salted, so identical PINs produce different
  // hashes and no DB constraint can catch this — it must be a scrypt verify
  // against every active credential. Two holders sharing digits would make the
  // login path ambiguous. ────────────────────────────────────────────────────
  for (const row of active) {
    if (await verifyBackupPin(pin, row.pin_hash)) {
      return { ok: false, error: "That PIN is already in use. Choose different digits." };
    }
  }

  const pinHash = await hashBackupPin(pin);
  const { error } = await supabase.from("admin_backup_pin").insert({
    pin_hash: pinHash,
    expires_at: expiresAtIso,
    player_id: playerId,
    holder_name: holderName,
  });

  if (error) {
    return { ok: false, error: "Could not save the PIN. Try again." };
  }
  return { ok: true, pin, holderName, expiresAt: expiresAtIso };
}

/**
 * Every credential that currently grants access, soonest expiry first.
 *
 * Expired and revoked credentials are FILTERED OUT, never deleted — the audit
 * trail (admin_backup_audit.credential_id) depends on those rows surviving.
 *
 * THROWS if the list cannot be read. It deliberately does NOT degrade to an
 * empty array: on a security screen "[] holders" reads as "nobody can get in",
 * and quietly showing that when we simply failed to check is a worse lie than
 * an error. The caller renders a load-failure state instead.
 */
export async function listBackupPins(): Promise<BackupPinHolder[]> {
  const { data, error } = await supabase
    .from("admin_backup_pin")
    // Deliberately no pin_hash: nothing derived from the PIN reaches the browser.
    .select("id, player_id, holder_name, expires_at, created_at")
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: true });

  if (error || !data) {
    throw new Error("Could not read the list of backup PIN holders.");
  }
  return (data as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    holderName: (r.holder_name as string | null) ?? null,
    playerId: r.player_id === null || r.player_id === undefined ? null : Number(r.player_id),
    expiresAt: String(r.expires_at),
    createdAt: String(r.created_at),
  }));
}

/**
 * Revoke ONE credential by id — not "the active one". Immediate-revoke is
 * enforced by the middleware re-check on the holder's next request (R4).
 */
export async function revokeBackupPin(id: number): Promise<{ ok: boolean }> {
  if (!Number.isInteger(id)) return { ok: false };
  const { error } = await supabase
    .from("admin_backup_pin")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null);
  return { ok: !error };
}
