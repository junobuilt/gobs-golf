import type { RoundState, RoundStateInput } from "./types";

const MIN_TEAMS = 2;
const MIN_PLAYERS_PER_TEAM = 2;

function teamsBuilt(input: RoundStateInput): boolean {
  const valid = input.teams.filter(
    (t) => t.teamNumber > 0 && t.playerCount >= MIN_PLAYERS_PER_TEAM,
  );
  return valid.length >= MIN_TEAMS;
}

export function deriveRoundState(input: RoundStateInput): RoundState {
  if (input.round === null) return "no_round";
  if (input.round.isComplete) return "complete";

  const hasFormat = input.round.format !== null;

  if (input.anyScoreEntered) {
    if (!hasFormat) {
      throw new Error(
        "deriveRoundState: invariant violated — scores entered but rounds.format is null",
      );
    }
    return "scoring";
  }

  const built = teamsBuilt(input);

  if (hasFormat && built) return "scorecards_unlocked";
  if (hasFormat) return "format_chosen";
  if (built) return "teams_built";
  return "setup";
}
