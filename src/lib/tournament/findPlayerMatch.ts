// Pure player→match resolution over already-loaded matches (no query). Given a
// day's LoadedMatch[] and a player_id, find the match that player is in (either
// side). Because it resolves per day, a stored identity lands on the player's
// NEW match on day 2/3 automatically.

import type { LoadedMatch } from "./types";

export function findMatchForPlayer(
  matches: ReadonlyArray<LoadedMatch>,
  playerId: number,
): LoadedMatch | undefined {
  return matches.find(
    (m) =>
      m.sideA.players.some((p) => p.playerId === playerId) ||
      m.sideB.players.some((p) => p.playerId === playerId),
  );
}

// A day carrying its date + matches — the shape the landing already holds.
export interface DayLike {
  session: { day_number: number; played_on: string | null };
  matches: ReadonlyArray<LoadedMatch>;
}

// Resolve a player to their NEAREST match, not "today's": the soonest day that
// is today-or-later; if all their days are in the past, the most recent (so it
// never blanks post-tournament, and a night-before / future-dated open still
// resolves). null when the player has no match on any day. `today` is an ISO
// YYYY-MM-DD string — played_on is the same format, so lexicographic compare is
// chronological. A null played_on is treated as undated (never "upcoming").
export function findNearestMatchForPlayer<D extends DayLike>(
  days: ReadonlyArray<D>,
  playerId: number,
  today: string,
): { day: D; match: LoadedMatch } | null {
  const inMatches = days
    .map((day) => {
      const match = findMatchForPlayer(day.matches, playerId);
      return match ? { day, match, playedOn: day.session.played_on ?? "" } : null;
    })
    .filter((x): x is { day: D; match: LoadedMatch; playedOn: string } => x != null);
  if (inMatches.length === 0) return null;

  const upcoming = inMatches
    .filter((x) => x.playedOn >= today)
    .sort((a, b) => a.playedOn.localeCompare(b.playedOn));
  if (upcoming.length > 0) return { day: upcoming[0].day, match: upcoming[0].match };

  // All past → most recent.
  const mostRecent = [...inMatches].sort((a, b) => b.playedOn.localeCompare(a.playedOn))[0];
  return { day: mostRecent.day, match: mostRecent.match };
}

// Unique {playerId, displayName} across every day's matches, sorted by name —
// the roster for the "Who are you?" picker (players who have a pairing).
export function tournamentPlayersFromDays(
  dayMatches: ReadonlyArray<ReadonlyArray<LoadedMatch>>,
): Array<{ playerId: number; displayName: string }> {
  const seen = new Map<number, string>();
  for (const matches of dayMatches) {
    for (const m of matches) {
      for (const p of [...m.sideA.players, ...m.sideB.players]) {
        if (!seen.has(p.playerId)) seen.set(p.playerId, p.displayName);
      }
    }
  }
  return [...seen.entries()]
    .map(([playerId, displayName]) => ({ playerId, displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
