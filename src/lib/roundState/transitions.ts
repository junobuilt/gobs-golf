import type { RoundAction, RoundState, TransitionResult } from "./types";

type TransitionTable = {
  [from in RoundState]?: { [action in RoundAction]?: RoundState };
};

const TRANSITIONS: TransitionTable = {
  no_round: {
    create_round: "setup",
  },
  setup: {
    build_teams: "teams_built",
    choose_format: "format_chosen",
    delete_round: "no_round",
  },
  teams_built: {
    choose_format: "scorecards_unlocked",
    tear_down_teams: "setup",
    delete_round: "no_round",
  },
  format_chosen: {
    build_teams: "scorecards_unlocked",
    clear_format: "setup",
    delete_round: "no_round",
  },
  scorecards_unlocked: {
    enter_first_score: "scoring",
    clear_format: "teams_built",
    tear_down_teams: "format_chosen",
    delete_round: "no_round",
  },
  scoring: {
    complete_round: "complete",
    clear_format: "teams_built",
    tear_down_teams: "format_chosen",
    delete_round: "no_round",
  },
  complete: {
    reopen_round: "scoring",
    delete_round: "no_round",
  },
};

export function nextStateForAction(
  current: RoundState,
  action: RoundAction,
): TransitionResult {
  const allowed = TRANSITIONS[current];
  const next = allowed?.[action];
  if (!next) {
    return {
      ok: false,
      reason: `Action "${action}" is not allowed from state "${current}"`,
    };
  }
  return { ok: true, next };
}

export function isTerminal(state: RoundState): boolean {
  return state === "complete";
}

export function canEnterScores(state: RoundState): boolean {
  return state === "scorecards_unlocked" || state === "scoring";
}
