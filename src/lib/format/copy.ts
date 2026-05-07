import type { Format, FormatConfig } from "@/lib/scoring/types";

export const FORMAT_ORDER: Format[] = [
  "2_ball",
  "3_ball",
  "stableford_standard",
  "stableford_modified",
  "gobs_house",
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
  "stableford_standard": {
    title: "Stableford Standard",
    oneLiner: "Points per net score: bogey 1, par 2, birdie 3, eagle 4. Highest total wins.",
  },
  "stableford_modified": {
    title: "Stableford Modified",
    oneLiner: "Stableford Standard with custom point values you set per round.",
  },
  "gobs_house": {
    title: "GOBS House",
    oneLiner: "Stableford Standard with −1 for net double bogey or worse.",
  },
};

const STABLEFORD_STANDARD_POINTS: Record<string, number> = {
  "double_bogey_or_worse": 0,
  "bogey": 1,
  "par": 2,
  "birdie": 3,
  "eagle": 4,
  "albatross": 5,
};

// Format-aware team total display (C3). Caller passes the natural value for
// the format:
//   - best-N (2_ball / 3_ball): `total` is the delta vs par. Renders "E"
//     when zero, "+N" when positive, "−N" (Unicode U+2212) when negative.
//   - Stableford-family: `total` is absolute team points (engine teamScore).
//     Renders "${total} pts" with Unicode minus on negative GOBS House totals.
//
// Stableford and best-N have intentionally different input semantics — the
// helper does not compute deltas, it formats them. Callers decide which value
// is meaningful for the format and pass it in.
export function formatTeamTotal(total: number, format: Format): string {
  const isStableford =
    format === "stableford_standard" ||
    format === "stableford_modified" ||
    format === "gobs_house";

  if (isStableford) {
    if (total < 0) return `−${-total} pts`;
    return `${total} pts`;
  }

  // best-N stroke-delta
  if (total === 0) return "E";
  if (total > 0) return `+${total}`;
  return `−${-total}`;
}

export const DEFAULT_FORMAT_CONFIG: Record<Format, FormatConfig> = {
  "2_ball": { basis: "net", scoring_basis: "net", best_n: 2, override_holes: [] },
  "3_ball": { basis: "net", scoring_basis: "net", best_n: 3, override_holes: [] },
  "stableford_standard": { basis: "net", scoring_basis: "net", override_holes: [] },
  "stableford_modified": {
    basis: "net",
    scoring_basis: "net",
    point_values: { ...STABLEFORD_STANDARD_POINTS },
    override_holes: [],
  },
  "gobs_house": { basis: "net", scoring_basis: "net", override_holes: [] },
};
