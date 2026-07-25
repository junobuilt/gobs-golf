// Returns YYYY-MM-DD in the client's local timezone. The league plays at
// Semiahmoo (PT) and is single-region — all `rounds.played_on` values are
// stored as the local calendar date, NOT UTC. This is intentional: it keeps
// "today" consistent between the admin's date picker and the player's
// homepage Start a Scorecard button regardless of evening UTC rollover.
//
// Caveat: if a player ever opens the app from a different timezone (travel,
// future expansion), "today" will resolve to their local date, not the
// league's. Not a problem today; revisit if multi-region usage emerges.
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function yesterdayLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Add `days` calendar days to an ISO date (YYYY-MM-DD) and return ISO. Uses UTC
// arithmetic on the parsed components so it is timezone- and DST-safe (no local
// Date rollover). `days` may be negative. Used to lay out a tournament's
// consecutive playing days from its start date.
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// Human display for an ISO date: "Sat Jul 25, 2026". Single source of truth for
// this format — the admin History tab (src/app/admin/tabs/History.tsx) imports
// this rather than keeping its own copy, so the two never drift. The T12:00:00
// anchor avoids a UTC-vs-local day rollover at the string's midnight.
export function formatDisplayDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
