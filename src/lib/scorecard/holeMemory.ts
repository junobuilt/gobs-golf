// Scorecard last-viewed-hole memory (both apps).
//
// Persists the hole a player is currently viewing so returning to the
// scorecard after a detour (leaderboard, tab switch, phone lock) reopens on
// that hole instead of numeric hole 1. Mirrors the guarded localStorage
// pattern in deviceMemory.ts exactly: a `gobs:`-namespaced key, a
// `typeof window` guard, and try/catch around every access so private-
// browsing / hardened browsers degrade to "no memory" rather than throwing.
//
// The `key` uniquely identifies ONE scorecard so a saved hole never leaks
// across rounds or between groups on a shared admin phone:
//   - regular league: `round:<roundId>:team:<teamFilter ?? "all">`
//   - tournament:     `tournament:match:<matchId>`

import { isValidHole } from "./resumeHole";

const PREFIX = "gobs:sc-hole:";

/** Read the remembered hole for a scorecard, or null if none / invalid / blocked. */
export function getSavedHole(key: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw == null) return null;
    const n = Number(raw);
    return isValidHole(n) ? n : null;
  } catch {
    return null;
  }
}

/** Remember the current hole for a scorecard. Ignores out-of-range holes. */
export function setSavedHole(key: string, hole: number): void {
  if (typeof window === "undefined") return;
  if (!isValidHole(hole)) return;
  try {
    window.localStorage.setItem(PREFIX + key, String(hole));
  } catch {
    /* storage blocked — best effort, no throw */
  }
}
