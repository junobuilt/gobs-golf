import type { Format } from "@/lib/scoring/types";

export type { Format };

export type RoundState =
  | "no_round"
  | "setup"
  | "teams_built"
  | "format_chosen"
  | "scorecards_unlocked"
  | "scoring"
  | "complete";

export type RoundStateInput = {
  round: null | {
    id: number;
    isComplete: boolean;
    format: Format | null;
    formatLockedAt: string | null;
  };
  teams: Array<{ teamNumber: number; playerCount: number }>;
  anyScoreEntered: boolean;
};

export type RoundAction =
  | "create_round"
  | "build_teams"
  | "choose_format"
  | "enter_first_score"
  | "complete_round"
  | "reopen_round"
  | "clear_format"
  | "tear_down_teams"
  | "delete_round";

export type TransitionResult =
  | { ok: true; next: RoundState }
  | { ok: false; reason: string };
