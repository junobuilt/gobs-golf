// THE shared ranking core for the round-results surfaces. Composes the two
// existing pure helpers — rankTeams (order + skip-tie ranks, rank.ts) and
// formatTeamTotal (the "−4" / "E" / "12 pts" string, format/copy.ts) — and
// adds a tie-aware place label. The History list rows (loadRoundsList) AND
// RoundResultsView both read team standings from HERE, so the list can never
// silently diverge from the detail on rank, total string, or place.
//
// LOCKED PATTERN: never reimplement ranking or total formatting inside a loader
// or component — call rankAndFormatTeams (or formatTeamTotal/rankTeams) instead.

import type { Format } from "@/lib/scoring/types";
import { rankTeams, type TeamWithTotal, type RankedTeam } from "./rank";
import { formatTeamTotal } from "@/lib/format/copy";

export type RankedFormattedTeam<T> = RankedTeam<T> & {
  // Headline total string, IDENTICAL to the RoundResultsView headline:
  // "−4" / "E" / "+3" for best-N, "12 pts" / "−1 pts" for Stableford.
  totalLabel: string;
  // Tie-aware standing: "6th of 8" / "T2 of 8" / "1st of 8".
  placeLabel: string;
};

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// Tie-aware place label. `rank` uses rankTeams' skip-tie numbering (1, 2, 2, 4);
// `isTie` is true when 2+ teams share this rank. Tied → "T2 of 8" (the "T"
// reads as "tied for 2nd", which a naive array index would miss); otherwise an
// ordinal "6th of 8".
export function formatPlace(rank: number, totalTeams: number, isTie: boolean): string {
  return isTie ? `T${rank} of ${totalTeams}` : `${ordinal(rank)} of ${totalTeams}`;
}

export function rankAndFormatTeams<T>(
  teams: ReadonlyArray<TeamWithTotal<T>>,
  format: Format,
): Array<RankedFormattedTeam<T>> {
  const ranked = rankTeams(teams, format);
  const totalTeams = ranked.length;

  // A rank is a tie when more than one team carries it (skip-tie numbering
  // means tied teams share the rank integer, e.g. two at rank 2 → next is 4).
  const rankCounts = new Map<number, number>();
  for (const t of ranked) rankCounts.set(t.rank, (rankCounts.get(t.rank) ?? 0) + 1);

  return ranked.map(t => ({
    ...t,
    totalLabel: formatTeamTotal(t.total, format),
    placeLabel: formatPlace(t.rank, totalTeams, (rankCounts.get(t.rank) ?? 1) > 1),
  }));
}
