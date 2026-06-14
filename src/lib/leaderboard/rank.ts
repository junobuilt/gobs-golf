import type { Format } from "@/lib/scoring/types";

// Pure rank/sort helpers for the live team leaderboard. Kept format-aware so
// stroke-play formats sort ascending (lowest team total wins) and Stableford
// formats sort descending (highest team points wins). Tie handling: tied teams
// share the same rank number; the rank position is then skipped (e.g. two
// teams tied at rank 1 → next team is rank 3, not rank 2).

export type TeamWithTotal<T> = T & { total: number };
export type RankedTeam<T> = TeamWithTotal<T> & { rank: number };

const STABLEFORD_FORMATS: Format[] = [
  "stableford_standard",
  "gobs_stableford",
];

export function isStablefordFormat(format: Format): boolean {
  return STABLEFORD_FORMATS.includes(format);
}

// "Does this format rank teams DESCENDING (highest total wins)?" The Stableford
// family (points) plus Par Competition (record vs the course). Deliberately
// SEPARATE from isStablefordFormat: par_competition ranks descending at the TEAM
// level, but its individuals are still ranked by net STROKES (ascending) via the
// best-N branch in results.ts — widening isStablefordFormat would wrongly flip
// individuals to a points ranking. Only the team sort direction is shared.
export function ranksDescending(format: Format): boolean {
  return isStablefordFormat(format) || format === "par_competition";
}

// Returns the input rows in display order with `rank` assigned. Pure: does
// not mutate input. Stable for equal totals (preserves input order).
export function rankTeams<T>(
  teams: ReadonlyArray<TeamWithTotal<T>>,
  format: Format,
): Array<RankedTeam<T>> {
  const ascending = !ranksDescending(format);

  // Decorate-sort-undecorate to keep tie-break stable. Sort by total in the
  // direction the format requires; on equal totals, fall back to original
  // index so the order is deterministic.
  const decorated = teams.map((team, idx) => ({ team, idx }));
  decorated.sort((a, b) => {
    const diff = ascending
      ? a.team.total - b.team.total
      : b.team.total - a.team.total;
    if (diff !== 0) return diff;
    return a.idx - b.idx;
  });

  // Assign ranks with "skip" tie behavior: positions counted by index but
  // rank only advances when total changes.
  const ranked: Array<RankedTeam<T>> = [];
  for (let position = 0; position < decorated.length; position++) {
    const { team } = decorated[position];
    const prev = position > 0 ? decorated[position - 1].team : null;
    const isTieWithPrev = prev !== null && prev.total === team.total;
    const rank = isTieWithPrev ? ranked[position - 1].rank : position + 1;
    ranked.push({ ...team, rank });
  }
  return ranked;
}

// Returns the count of holes where every required player on the team has
// entered a score. Pure. `scoresByPlayer[playerId][holeNumber]` is a strokes
// integer or undefined/null when missing. A hole counts only when ALL
// required players have a non-null entry — partial-hole rows don't tick.
export function holesCompleteForTeam(
  scoresByPlayer: Record<number, Record<number, number | null | undefined>>,
  requiredPlayerIds: ReadonlyArray<number>,
): number {
  if (requiredPlayerIds.length === 0) return 0;
  let count = 0;
  for (let hole = 1; hole <= 18; hole++) {
    const allScored = requiredPlayerIds.every(pid => {
      const v = scoresByPlayer[pid]?.[hole];
      return v != null;
    });
    if (allScored) count++;
  }
  return count;
}
