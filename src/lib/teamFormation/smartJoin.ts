export interface RoundPlayer {
  id: number;
  player_id: number;
  team_number: number;
  players: { full_name: string; display_name: string };
}

export type SmartJoinResult =
  | { kind: 'create_new'; playerIds: number[]; nextTeamNumber: number }
  | { kind: 'silent_join'; teamNumber: number }
  | { kind: 'confirm_join'; teamNumber: number; existingRoster: RoundPlayer[]; playerIdsToAdd: number[] }
  | { kind: 'mixed_teams_error'; teamA: number; teamB: number; playersA: RoundPlayer[]; playersB: RoundPlayer[] };

export function resolveSmartJoin(
  selection: number[],
  roundPlayers: RoundPlayer[],
): SmartJoinResult {
  const uniqueIds = [...new Set(selection)];

  const rpByPlayerId = new Map<number, RoundPlayer>();
  for (const rp of roundPlayers) {
    rpByPlayerId.set(rp.player_id, rp);
  }

  // Map each selected player_id to its team_number (0 if not in round)
  const teamNumbers = uniqueIds.map(pid => rpByPlayerId.get(pid)?.team_number ?? 0);

  const nonZeroTeams = [...new Set(teamNumbers.filter(t => t !== 0))].sort((a, b) => a - b);

  if (nonZeroTeams.length === 0) {
    const maxTeam = roundPlayers.reduce((max, rp) => Math.max(max, rp.team_number), 0);
    return { kind: 'create_new', playerIds: uniqueIds, nextTeamNumber: maxTeam + 1 };
  }

  if (nonZeroTeams.length === 1) {
    const team = nonZeroTeams[0];
    const allOnTeam = teamNumbers.every(t => t === team);
    if (allOnTeam) {
      return { kind: 'silent_join', teamNumber: team };
    }
    const existingRoster = roundPlayers.filter(rp => rp.team_number === team);
    const playerIdsToAdd = uniqueIds.filter(pid => (rpByPlayerId.get(pid)?.team_number ?? 0) === 0);
    return { kind: 'confirm_join', teamNumber: team, existingRoster, playerIdsToAdd };
  }

  // nonZeroTeams.length >= 2
  const [teamA, teamB] = nonZeroTeams;
  const playersA = uniqueIds
    .filter(pid => (rpByPlayerId.get(pid)?.team_number ?? 0) === teamA)
    .map(pid => rpByPlayerId.get(pid)!);
  const playersB = uniqueIds
    .filter(pid => (rpByPlayerId.get(pid)?.team_number ?? 0) === teamB)
    .map(pid => rpByPlayerId.get(pid)!);
  return { kind: 'mixed_teams_error', teamA, teamB, playersA, playersB };
}
