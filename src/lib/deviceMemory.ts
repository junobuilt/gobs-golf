// Artifact/SSR-safe device memory: a single localStorage string holding the
// player's identity ON THIS DEVICE (no account, no server). Matches the guarded
// pattern the homepage uses for its sessionStorage flag — a `gobs:` namespaced
// key, a `typeof window` guard, and try/catch around every access so private
// browsing / hardened browsers degrade to "no memory" rather than throwing.
//
// It stores an IDENTITY (player_id), never a match id — so day 2/3 resolve to
// the player's NEW match automatically without re-asking.

const KEY = "gobs:tournament-player-id";
// Parallel key: the display name the user tapped, so the greeting can show their
// real name even when they aren't in a pairing yet (the match-derived roster
// wouldn't know them). Purely cosmetic — identity is still the id above.
const NAME_KEY = "gobs:tournament-player-name";

export function getStoredPlayerName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(NAME_KEY);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

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

export function setStoredPlayerId(id: number, name?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, String(id));
    if (name && name.trim()) window.localStorage.setItem(NAME_KEY, name);
    else window.localStorage.removeItem(NAME_KEY);
  } catch {
    /* storage blocked — best effort, no throw */
  }
}

export function clearStoredPlayerId(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
    window.localStorage.removeItem(NAME_KEY);
  } catch {
    /* storage blocked */
  }
}
