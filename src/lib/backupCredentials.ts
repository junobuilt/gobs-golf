// Backup-admin credential RESOLUTION — "which active credential does this PIN
// belong to?". Node runtime only (pulls `verifyBackupPin` → node:crypto scrypt);
// imported by the /admin/login server action. Never reaches the client bundle.
//
// SSOT for the login-side lookup. Before v2 the login path resolved ONE
// credential (`.order(created_at desc).limit(1)`) and compared the entered PIN
// against it. That was correct while exactly one credential could be active, but
// v2 lets several named people hold a PIN simultaneously — under which the old
// query authenticated only the most recently created holder and told everyone
// else "Incorrect PIN", with nothing in the logs to explain it. This module
// replaces that with a scan over EVERY active credential.
//
// Security posture (deliberate, do not "optimize"):
//   - Every candidate gets a FULL peppered scrypt verify. There is no plaintext
//     shortcut and no lookup index on the PIN — either would defeat the reason
//     the hash is peppered in the first place (see backupPin.ts's header).
//   - Candidates are bounded by the number of people who can hold a PIN at once
//     (the active roster, ~54; realistically single digits), so the cost of the
//     scan is irrelevant in practice and is only paid in full on a FAILED login.

import { supabase } from "@/lib/supabase";
import { verifyBackupPin } from "@/lib/backupPin";

export type ResolvedBackupCredential = {
  credId: number;
  expiresAtMs: number;
};

/**
 * Find the active backup credential whose stored hash matches `pin`.
 *
 * "Active" is the same predicate the middleware re-check uses: not revoked AND
 * not expired. Returns the MATCHING credential's own id + expiry (the caller
 * binds the session cookie to these — binding to any other row's expiry would
 * hand a holder someone else's window), or null when no active credential
 * matches. Never throws: a DB error resolves to null so the caller falls through
 * to the generic "Incorrect PIN" and the gate fails closed.
 */
export async function resolveActiveBackupCredential(
  pin: string
): Promise<ResolvedBackupCredential | null> {
  let rows: { id: number; pin_hash: string; expires_at: string }[];
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("admin_backup_pin")
      .select("id, pin_hash, expires_at")
      .is("revoked_at", null)
      .gt("expires_at", nowIso)
      // Soonest-expiring first purely so the scan order is deterministic; the
      // match is decided by the hash, never by position.
      .order("expires_at", { ascending: true });

    if (error || !data) return null;
    rows = data as typeof rows;
  } catch {
    return null;
  }

  for (const row of rows) {
    if (await verifyBackupPin(pin, row.pin_hash)) {
      const expiresAtMs = new Date(row.expires_at).getTime();
      if (!Number.isFinite(expiresAtMs)) return null;
      return { credId: Number(row.id), expiresAtMs };
    }
  }
  return null;
}
