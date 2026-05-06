import { describe, it, expect } from "vitest";
import {
  nextStateForAction,
  isTerminal,
  canEnterScores,
} from "@/lib/roundState/transitions";
import type { RoundAction, RoundState } from "@/lib/roundState/types";

function expectOk(current: RoundState, action: RoundAction, next: RoundState) {
  const result = nextStateForAction(current, action);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.next).toBe(next);
}

function expectBlocked(current: RoundState, action: RoundAction) {
  const result = nextStateForAction(current, action);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toMatch(/not allowed/i);
}

describe("nextStateForAction — allowed transitions", () => {
  it("no_round → create_round → setup", () => {
    expectOk("no_round", "create_round", "setup");
  });

  it("setup → build_teams → teams_built", () => {
    expectOk("setup", "build_teams", "teams_built");
  });

  it("setup → choose_format → format_chosen", () => {
    expectOk("setup", "choose_format", "format_chosen");
  });

  it("teams_built → choose_format → scorecards_unlocked", () => {
    expectOk("teams_built", "choose_format", "scorecards_unlocked");
  });

  it("teams_built → tear_down_teams → setup", () => {
    expectOk("teams_built", "tear_down_teams", "setup");
  });

  it("format_chosen → build_teams → scorecards_unlocked", () => {
    expectOk("format_chosen", "build_teams", "scorecards_unlocked");
  });

  it("format_chosen → clear_format → setup", () => {
    expectOk("format_chosen", "clear_format", "setup");
  });

  it("scorecards_unlocked → enter_first_score → scoring", () => {
    expectOk("scorecards_unlocked", "enter_first_score", "scoring");
  });

  it("scorecards_unlocked → clear_format → teams_built", () => {
    expectOk("scorecards_unlocked", "clear_format", "teams_built");
  });

  it("scorecards_unlocked → tear_down_teams → format_chosen", () => {
    expectOk("scorecards_unlocked", "tear_down_teams", "format_chosen");
  });

  it("scoring → complete_round → complete", () => {
    expectOk("scoring", "complete_round", "complete");
  });

  it("scoring → clear_format → teams_built (B1.6 dangerous unwind)", () => {
    expectOk("scoring", "clear_format", "teams_built");
  });

  it("scoring → tear_down_teams → format_chosen (B1.6 dangerous unwind)", () => {
    expectOk("scoring", "tear_down_teams", "format_chosen");
  });

  it("complete → reopen_round → scoring", () => {
    expectOk("complete", "reopen_round", "scoring");
  });

  it("delete_round routes every non-null state back to no_round", () => {
    const states: RoundState[] = [
      "setup",
      "teams_built",
      "format_chosen",
      "scorecards_unlocked",
      "scoring",
      "complete",
    ];
    for (const s of states) {
      expectOk(s, "delete_round", "no_round");
    }
  });
});

describe("nextStateForAction — disallowed transitions", () => {
  it("no_round blocks every action except create_round", () => {
    const blocked: RoundAction[] = [
      "build_teams",
      "choose_format",
      "enter_first_score",
      "complete_round",
      "reopen_round",
      "clear_format",
      "tear_down_teams",
      "delete_round",
    ];
    for (const a of blocked) expectBlocked("no_round", a);
  });

  it("setup blocks enter_first_score", () => {
    expectBlocked("setup", "enter_first_score");
  });

  it("setup blocks complete_round", () => {
    expectBlocked("setup", "complete_round");
  });

  it("setup blocks reopen_round", () => {
    expectBlocked("setup", "reopen_round");
  });

  it("teams_built blocks enter_first_score (no format yet)", () => {
    expectBlocked("teams_built", "enter_first_score");
  });

  it("complete blocks enter_first_score", () => {
    expectBlocked("complete", "enter_first_score");
  });

  it("disallowed transition reason names the action and the state", () => {
    const result = nextStateForAction("setup", "enter_first_score");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("enter_first_score");
      expect(result.reason).toContain("setup");
    }
  });
});

describe("isTerminal", () => {
  it("is true only for complete", () => {
    const states: RoundState[] = [
      "no_round",
      "setup",
      "teams_built",
      "format_chosen",
      "scorecards_unlocked",
      "scoring",
      "complete",
    ];
    for (const s of states) {
      expect(isTerminal(s)).toBe(s === "complete");
    }
  });
});

describe("canEnterScores", () => {
  it("is true for scorecards_unlocked and scoring, false elsewhere", () => {
    expect(canEnterScores("scorecards_unlocked")).toBe(true);
    expect(canEnterScores("scoring")).toBe(true);
    expect(canEnterScores("no_round")).toBe(false);
    expect(canEnterScores("setup")).toBe(false);
    expect(canEnterScores("teams_built")).toBe(false);
    expect(canEnterScores("format_chosen")).toBe(false);
    expect(canEnterScores("complete")).toBe(false);
  });
});
