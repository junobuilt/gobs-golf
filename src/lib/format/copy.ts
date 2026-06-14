import type { Format, FormatConfig } from "@/lib/scoring/types";
import { GOBS_STABLEFORD_POINTS } from "@/lib/scoring/engine";

// Drives the admin FormatPicker's selectable list. "shambles" (Wave 1B) was
// held out until its team-card entry surface (C2), routing + read surfaces (C3)
// existed; added in C3b now that selecting it is fully wired end-to-end.
export const FORMAT_ORDER: Format[] = [
  "2_ball",
  "3_ball",
  "best_ball",
  "stableford_standard",
  "gobs_stableford",
  "shambles",
  "texas_scramble",
  "alternate_shot",
  "par_competition",
];

export const FORMAT_LABELS: Record<Format, { title: string; oneLiner: string }> = {
  "2_ball": {
    title: "2-Ball",
    oneLiner: "Best 2 net scores per hole. Lowest team total wins.",
  },
  "3_ball": {
    title: "3-Ball",
    oneLiner: "Best 3 net scores per hole. 4-player teams drop the worst.",
  },
  "best_ball": {
    title: "Best Ball",
    oneLiner: "Best 1 net score per hole. Net only. Lowest team total wins.",
  },
  "stableford_standard": {
    title: "Stableford Standard",
    oneLiner: "Points per net score: bogey 1, par 2, birdie 3, eagle 5, albatross 8. Highest total wins.",
  },
  "gobs_stableford": {
    title: "GOBS Stableford",
    oneLiner: "League point values you can edit per round. Highest total wins.",
  },
  "shambles": {
    title: "Shambles",
    oneLiner: "Everyone plays their own ball after the team drive; take the best 1 (or 2) net per hole. Net only. Lowest team total wins.",
  },
  "texas_scramble": {
    title: "Texas Scramble",
    oneLiner: "One team ball per hole. Net via a weighted team handicap (35/15, 20/15/10, 20/15/10/5 by team size). Lowest net wins.",
  },
  "alternate_shot": {
    title: "Alternate Shot",
    oneLiner: "Two-player teams, one ball per hole. Net off half the combined handicaps. Lowest net wins.",
  },
  "par_competition": {
    title: "Par Competition",
    oneLiner: "Match play vs the course. Best net ball each hole: win (+1), halve (0), lose (−1). Highest record wins.",
  },
};

// Format-aware team total display (C3). Caller passes the natural value for
// the format:
//   - best-N (2_ball / 3_ball): `total` is the delta vs par. Renders "E"
//     when zero, "+N" when positive, "−N" (Unicode U+2212) when negative.
//   - Stableford-family: `total` is absolute team points (engine teamScore).
//     Renders "${total} pts" with Unicode minus on negative totals (GOBS
//     Stableford defaults can dip below zero from double-bogey-or-worse).
//   - Par Competition: `total` is the summed RECORD (+N up on the course / E /
//     −N down). The STRING is identical to best-N (+N / E / −N) — the meaning
//     (and color: green = positive, OPPOSITE to best-N) is the view's concern.
//     Kept as an explicit branch so a future best-N string change can't silently
//     alter the record display.
//
// Stableford and best-N have intentionally different input semantics — the
// helper does not compute deltas, it formats them. Callers decide which value
// is meaningful for the format and pass it in.
export function formatTeamTotal(total: number, format: Format): string {
  const isStableford =
    format === "stableford_standard" ||
    format === "gobs_stableford";

  if (isStableford) {
    if (total < 0) return `−${-total} pts`;
    return `${total} pts`;
  }

  if (format === "par_competition") {
    // Record style: +N / E / −N. Same glyphs as best-N (see above).
    if (total === 0) return "E";
    if (total > 0) return `+${total}`;
    return `−${-total}`;
  }

  // best-N stroke-delta
  if (total === 0) return "E";
  if (total > 0) return `+${total}`;
  return `−${-total}`;
}

// JSON-storable key shape for GOBS Stableford's editable point_values. Matches
// the StablefordPointTable shape consumed by the engine via mergePointTable.
const GOBS_STABLEFORD_DEFAULT_POINT_VALUES: Record<string, number> = {
  doubleBogeyOrWorse: GOBS_STABLEFORD_POINTS.doubleBogeyOrWorse,
  bogey: GOBS_STABLEFORD_POINTS.bogey,
  par: GOBS_STABLEFORD_POINTS.par,
  birdie: GOBS_STABLEFORD_POINTS.birdie,
  eagle: GOBS_STABLEFORD_POINTS.eagle,
  albatross: GOBS_STABLEFORD_POINTS.albatross,
};

// Used when ensuring a round shell exists before any format has been picked.
// `rounds.format_config` is NOT NULL in the DB, so we can't insert null — but
// we also don't want to leak format-specific shape (best_n, point_values) into
// a row whose format is still null. The picker overwrites the entire config
// the moment a format is chosen, so this shape is only ever live for the gap
// between shell creation and first format selection. Engine helpers
// (getScoringBasis, getOverrideHoles, readGobsPointValues) all tolerate the
// optional keys being absent.
export const DEFAULT_FORMAT_CONFIG_SHELL: FormatConfig = {
  basis: "net",
  scoring_basis: "net",
  override_holes: [],
};

export const DEFAULT_FORMAT_CONFIG: Record<Format, FormatConfig> = {
  "2_ball": { basis: "net", scoring_basis: "net", best_n: 2, override_holes: [] },
  "3_ball": { basis: "net", scoring_basis: "net", best_n: 3, override_holes: [] },
  // Best Ball is locked to net-only by spec. scoring_basis still defaults to
  // "net" so the FormatPicker UI shows the correct (disabled) selection.
  "best_ball": { basis: "net", scoring_basis: "net", best_n: 1, override_holes: [] },
  "stableford_standard": { basis: "net", scoring_basis: "net", override_holes: [] },
  "gobs_stableford": {
    basis: "net",
    scoring_basis: "net",
    point_values: { ...GOBS_STABLEFORD_DEFAULT_POINT_VALUES },
    override_holes: [],
  },
  // Wave 1B follow-up: Shambles is an individual best-ball NET format. Net only
  // (locked in the picker like Best Ball) — the per-player engine allocates
  // strokes and takes the best team_ball_count (1 or 2) NET balls per hole.
  // team_ball_count defaults to 1 (admin may set 2 via the picker).
  "shambles": {
    basis: "net",
    scoring_basis: "net",
    team_ball_count: 1,
    override_holes: [],
  },
  // Phase 1C: NET team-card formats. One team ball per hole (count-1, so no
  // team_ball_count / best_n), net-locked like Best Ball. The team handicap is
  // derived from members' raw CHs at score time (computeTeamHandicap), not from
  // any config key. override_holes is a no-op (one team score per hole).
  "texas_scramble": { basis: "net", scoring_basis: "net", override_holes: [] },
  "alternate_shot": { basis: "net", scoring_basis: "net", override_holes: [] },
  // Par Competition: individual best-1 NET selection mapped to ±1/0/−1 vs par.
  // Net-locked like Best Ball; no best_n/team_ball_count (N is always 1);
  // override_holes is a no-op (hidden in the picker, like Stableford).
  "par_competition": { basis: "net", scoring_basis: "net", override_holes: [] },
};
