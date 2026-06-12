/**
 * Sum a team's per-player Course Handicaps for the admin Round Setup team-card
 * label ("Team CH"). DISPLAY-ONLY — this figure feeds nothing scored, ranked,
 * or paid (scoring reads CH via teamTotals.ts / results.ts from their own
 * queries; payouts read round_payouts).
 *
 * Returns null when ANY rostered player's course_handicap is null (e.g. teams
 * formed before scorecards opened, so CH isn't computed yet) — the caller shows
 * "—" rather than a misleading partial sum. Returns 0 only for an empty roster.
 */
export function sumCourseHandicaps(chs: (number | null)[]): number | null {
  let total = 0;
  for (const ch of chs) {
    if (ch == null) return null;
    total += ch;
  }
  return total;
}
