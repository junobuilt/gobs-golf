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

export const DEFAULT_FORMAT_CONFIG: Record<Format, FormatConfig> = {
  "2_ball": { basis: "net", best_n: 2, override_holes: [] },
  "3_ball": { basis: "net", best_n: 3, override_holes: [] },
  "stableford_standard": { basis: "net", override_holes: [] },
  "stableford_modified": {
    basis: "net",
    point_values: { ...STABLEFORD_STANDARD_POINTS },
    override_holes: [],
  },
  "gobs_house": { basis: "net", override_holes: [] },
};
