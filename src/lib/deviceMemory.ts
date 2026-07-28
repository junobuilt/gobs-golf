// Artifact/SSR-safe device memory: a single localStorage string holding the
// player's identity ON THIS DEVICE (no account, no server). Matches the guarded
// pattern the homepage uses for its sessionStorage flag — a `gobs:` namespaced
// key, a `typeof window` guard, and try/catch around every access so private
// browsing / hardened browsers degrade to "no memory" rather than throwing.
//
// It stores an IDENTITY (player_id), never a match id — so day 2/3 resolve to
// the player's NEW match automatically without re-asking.

const KEY = "gobs:tournament-player-id";

export function getStoredPlayerId(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function setStoredPlayerId(id: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, String(id));
  } catch {
    /* storage blocked — best effort, no throw */
  }
}

export function clearStoredPlayerId(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}
