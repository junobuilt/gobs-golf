import { describe, it, expect } from "vitest";
import { deriveRoundState } from "@/lib/roundState/derive";
import type { RoundStateInput } from "@/lib/roundState/types";

function input(overrides: Partial<RoundStateInput>): RoundStateInput {
  return {
    round: {
      id: 1,
      isComplete: false,
      format: null,
      formatLockedAt: null,
    },
    teams: [],
    anyScoreEntered: false,
    ...overrides,
  };
}

const fullTeams = [
  { teamNumber: 1, playerCount: 4 },
  { teamNumber: 2, playerCount: 4 },
];

describe("deriveRoundState", () => {
  it("returns no_round when round is null", () => {
    expect(deriveRoundState(input({ round: null }))).toBe("no_round");
  });

  it("returns setup when round exists, no teams, no format", () => {
    expect(deriveRoundState(input({}))).toBe("setup");
  });

  it("returns teams_built when ≥2 teams of ≥2 players, no format", () => {
    expect(deriveRoundState(input({ teams: fullTeams }))).toBe("teams_built");
  });

  it("returns format_chosen when format set but teams not built", () => {
    expect(
      deriveRoundState(
        input({
          round: {
            id: 1,
            isComplete: false,
            format: "2_ball",
            formatLockedAt: null,
          },
        }),
      ),
    ).toBe("format_chosen");
  });

  it("returns scorecards_unlocked when format set, teams built, no scores", () => {
    expect(
      deriveRoundState(
        input({
          round: {
            id: 1,
            isComplete: false,
            format: "2_ball",
            formatLockedAt: null,
          },
          teams: fullTeams,
        }),
      ),
    ).toBe("scorecards_unlocked");
  });

  it("returns scoring when ≥1 score entered and format locked", () => {
    expect(
      deriveRoundState(
        input({
          round: {
            id: 1,
            isComplete: false,
            format: "2_ball",
            formatLockedAt: "2026-05-06T17:00:00Z",
          },
          teams: fullTeams,
          anyScoreEntered: true,
        }),
      ),
    ).toBe("scoring");
  });

  it("returns complete when round.isComplete is true (overrides everything else)", () => {
    expect(
      deriveRoundState(
        input({
          round: {
            id: 1,
            isComplete: true,
            format: "2_ball",
            formatLockedAt: "2026-05-06T17:00:00Z",
          },
          teams: fullTeams,
          anyScoreEntered: true,
        }),
      ),
    ).toBe("complete");
  });

  it("returns complete even if format is null (e.g., reopened then format cleared by an admin tool)", () => {
    expect(
      deriveRoundState(
        input({
          round: {
            id: 1,
            isComplete: true,
            format: null,
            formatLockedAt: null,
          },
        }),
      ),
    ).toBe("complete");
  });

  it("throws when scores entered but format is null (data invariant violation)", () => {
    expect(() =>
      deriveRoundState(
        input({
          round: {
            id: 1,
            isComplete: false,
            format: null,
            formatLockedAt: null,
          },
          teams: fullTeams,
          anyScoreEntered: true,
        }),
      ),
    ).toThrow(/scores entered but rounds\.format is null/);
  });

  it("does not count teams with fewer than 2 players toward teams_built", () => {
    const result = deriveRoundState(
      input({
        teams: [
          { teamNumber: 1, playerCount: 4 },
          { teamNumber: 2, playerCount: 1 },
        ],
      }),
    );
    expect(result).toBe("setup");
  });

  it("excludes team_number 0 (unassigned) from team count", () => {
    const result = deriveRoundState(
      input({
        teams: [
          { teamNumber: 0, playerCount: 8 },
          { teamNumber: 1, playerCount: 4 },
        ],
      }),
    );
    expect(result).toBe("setup");
  });

  it("requires ≥2 valid teams (single 4-player team is not teams_built)", () => {
    const result = deriveRoundState(
      input({ teams: [{ teamNumber: 1, playerCount: 4 }] }),
    );
    expect(result).toBe("setup");
  });

  it("with format set, single valid team stays in format_chosen (not scorecards_unlocked)", () => {
    const result = deriveRoundState(
      input({
        round: {
          id: 1,
          isComplete: false,
          format: "2_ball",
          formatLockedAt: null,
        },
        teams: [{ teamNumber: 1, playerCount: 4 }],
      }),
    );
    expect(result).toBe("format_chosen");
  });
});
