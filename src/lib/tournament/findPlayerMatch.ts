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
