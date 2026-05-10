import type { Format, FormatConfig } from "@/lib/scoring/types";
import { GOBS_STABLEFORD_POINTS } from "@/lib/scoring/engine";

export const FORMAT_ORDER: Format[] = [
  "2_ball",
  "3_ball",
  "best_ball",
  "stableford_standard",
  "gobs_stableford",
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
};

// Format-aware team total display (C3). Caller passes the natural value for
// the format:
//   - best-N (2_ball / 3_ball): `total` is the delta vs par. Renders "E"
//     when zero, "+N" when positive, "−N" (Unicode U+2212) when negative.
//   - Stableford-family: `total` is absolute team points (engine teamScore).
//     Renders "${total} pts" with Unicode minus on negative totals (GOBS
//     Stableford defaults can dip below zero from double-bogey-or-worse).
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
};
