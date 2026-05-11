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
