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

// ── League-timezone (America/Vancouver) helpers ──────────────────────────────
//
// Added for Backup Admin PIN v2, where an expiry is chosen as a CALENDAR DATE
// and must behave the way the admin expects: a PIN assigned for "August 29"
// works all day on August 29 at the course, not until UTC midnight (which is
// 5pm local the previous day in summer).
//
// These resolve against the league's timezone explicitly rather than the
// process's local time, because the server runs on Vercel in UTC. At 6pm
// Vancouver the UTC date is already tomorrow — so a naive `new Date(dateStr)`
// past-date check would reject a same-day PIN, exactly when the admin is at the
// course handing one to a substitute. Intl only; no dependency, DST-correct.

const LEAGUE_TZ = "America/Vancouver";

/** Offset (ms) between the league timezone's wall clock and UTC at `utcMs`. */
function leagueOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LEAGUE_TZ,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));

  const p: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") p[part.type] = part.value;

  const asUTC = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour), Number(p.minute), Number(p.second)
  );
  return asUTC - utcMs;
}

/** Today's calendar date (YYYY-MM-DD) in the league's timezone. */
export function todayVancouver(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LEAGUE_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());

  const p: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

/** True when `iso` is a well-formed, real calendar date (rejects 2026-02-30). */
export function isValidISODate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

/**
 * The instant at which a league-timezone calendar date ENDS —
 * 23:59:59.999 local — as an ISO string. "August 29" therefore stays valid all
 * day on August 29 in Vancouver. Returns null for a malformed/unreal date.
 *
 * The two-step offset resolution handles DST: the offset is first sampled at the
 * naive instant, then re-sampled at the corrected one and reapplied if it moved.
 * 23:59:59 never falls in a transition window (Vancouver shifts at 2am), so the
 * result is unambiguous on both sides of a DST boundary.
 */
export function endOfDayVancouverISO(iso: string): string | null {
  if (!isValidISODate(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);

  // Resolve the offset on a whole-second instant — leagueOffsetMs reads
  // formatted parts, which carry no milliseconds, so sampling at .999 would
  // fold that 999ms into the offset and push the result into the next day. The
  // millisecond is added back after the offset is settled.
  const wall = Date.UTC(y, m - 1, d, 23, 59, 59);
  const off1 = leagueOffsetMs(wall);
  let ts = wall - off1;
  const off2 = leagueOffsetMs(ts);
  if (off2 !== off1) ts = wall - off2;

  return new Date(ts + 999).toISOString();
}

/**
 * Human copy for a league-timezone expiry: "August 29, 2027". SSOT for this
 * literal — it appears in the Settings holder list, the remove-confirmation, the
 * one-time reveal, AND in the server action's "already has a PIN (expires …)"
 * rejection. Those must agree, so they all call this rather than each keeping a
 * toLocaleDateString of their own.
 *
 * Accepts a full ISO instant (a stored expires_at) and renders it in the
 * league's timezone, so the date shown is the date the admin picked.
 */
export function formatLeagueDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: LEAGUE_TZ,
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Add `years` to an ISO date, clamping Feb 29 to Feb 28 in a non-leap target
 * (rather than rolling into March). Used for the one-year-out expiry ceiling.
 */
export function addYearsISO(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const targetY = y + years;
  const probe = new Date(Date.UTC(targetY, m - 1, d));
  // Rolled into the next month (Feb 29 -> Mar 1): step back to the last valid day.
  const day = probe.getUTCMonth() === m - 1 ? d : 0;
  const dt = day
    ? probe
    : new Date(Date.UTC(targetY, m, 0)); // day 0 = last day of month m-1
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
