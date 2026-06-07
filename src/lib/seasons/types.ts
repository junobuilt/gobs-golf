// Season management types (Phase H3).

export type Season = {
  id: number;
  name: string;
  started_on: string; // ISO date (YYYY-MM-DD)
  ended_on: string | null;
  is_active: boolean;
  created_at: string;
};

// Minimal round shape used by the season flows (the End-Season in-progress
// gate). Not the full round row — just what the block modal needs.
export type SeasonRound = {
  id: number;
  played_on: string;
  is_complete: boolean;
};

// Thrown by endSeason when the season still has unfinalized rounds. The caller
// (Settings UI) catches this and surfaces the "finalize it first" block modal
// using the attached rounds.
export class SeasonHasInProgressRounds extends Error {
  rounds: SeasonRound[];
  constructor(rounds: SeasonRound[]) {
    super("Season has in-progress rounds");
    this.name = "SeasonHasInProgressRounds";
    this.rounds = rounds;
  }
}
