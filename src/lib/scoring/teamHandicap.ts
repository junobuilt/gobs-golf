import type { Format } from "./types";

// Phase 1C — team handicap for the NET team-card formats (Texas Scramble,
// Alternate Shot).
//
// These formats play ONE team ball and take a SINGLE handicap deduction off the
// 18-hole team gross total (net = teamGross − teamHandicap). The deduction is a
// per-format weighting of the members' FULL (100%) course handicaps — these
// percentages ARE the USGA scramble/foursomes allowances, so the per-round
// handicap-allowance helper (getPlayingCourseHandicap) is deliberately NOT
// applied on top. Read the raw `round_players.course_handicap`.
//
// Locked rules (Dad, 2026-06-09):
//   Texas Scramble — members sorted by CH ascending ("low" = lowest CH, the
//   highest-weighted slot), weighted by team size:
//     2 players: 35% low + 15% other
//     3 players: 20% / 15% / 10%
//     4 players: 20% / 15% / 10% / 5%
//   Alternate Shot — (CH1 + CH2) / 2, EXACTLY 2 players.
//   Both: round the final team handicap to a whole number, .5 ROUNDS UP.
//
// No blind draw / short-team handling: these formats are never played with
// unbalanced teams (locked league rule). An unsupported member count returns
// null — callers (results.ts net total, the team-card Submit guard, the Alt-Shot
// picker guard) treat null as "can't score / blocked", never as a silent 0.

const SCRAMBLE_WEIGHTS: Record<number, number[]> = {
  2: [0.35, 0.15],
  3: [0.2, 0.15, 0.1],
  4: [0.2, 0.15, 0.1, 0.05],
};

// Round a fractional team handicap to a whole number, half ROUNDING UP. For the
// non-negative course handicaps the league stores, Math.round is exactly that
// (Math.round(2.5) === 3). Kept as a named helper so the .5-up intent is explicit.
function roundHalfUp(value: number): number {
  return Math.round(value);
}

// The team handicap for a NET team-card round, or null if the member count is
// unsupported for the format. `memberCourseHandicaps` are the members' raw
// (full, 100%) course handicaps; null entries (missing HI) coalesce to 0 — these
// formats assume every player carries a CH and are never played short, so a 0 is
// a defensive floor, not an expected input.
export function computeTeamHandicap(
  format: Format,
  memberCourseHandicaps: ReadonlyArray<number | null>,
): number | null {
  const chs = memberCourseHandicaps.map((ch) => ch ?? 0);

  if (format === "alternate_shot") {
    if (chs.length !== 2) return null;
    return roundHalfUp((chs[0] + chs[1]) / 2);
  }

  if (format === "texas_scramble") {
    const weights = SCRAMBLE_WEIGHTS[chs.length];
    if (!weights) return null;
    // Ascending CH so the lowest handicap takes the highest-weighted slot.
    const ascending = [...chs].sort((a, b) => a - b);
    const weighted = ascending.reduce(
      (sum, ch, i) => sum + ch * weights[i],
      0,
    );
    return roundHalfUp(weighted);
  }

  // Any other format has no team handicap (it isn't a NET team-card format).
  return null;
}
