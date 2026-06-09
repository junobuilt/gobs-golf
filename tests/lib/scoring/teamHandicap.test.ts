import { describe, it, expect } from "vitest";
import { computeTeamHandicap } from "@/lib/scoring/teamHandicap";

// Phase 1C — golden values for the NET team-card team-handicap formulas. Every
// expected value is hand-derived in the comment beside it. Negative controls:
// fixtures start in a state where the code must do real work (CH-ascending sort
// must run; the .5 must round UP) for the assertion to pass.

describe("computeTeamHandicap — Texas Scramble", () => {
  it("2 players: 35% low + 15% other", () => {
    // [8, 16] → 0.35*8 + 0.15*16 = 2.8 + 2.4 = 5.2 → 5
    expect(computeTeamHandicap("texas_scramble", [8, 16])).toBe(5);
  });

  it("2 players: .5 ROUNDS UP", () => {
    // [10, 20] → 0.35*10 + 0.15*20 = 3.5 + 3.0 = 6.5 → 7 (half-up, not 6)
    expect(computeTeamHandicap("texas_scramble", [10, 20])).toBe(7);
    expect(computeTeamHandicap("texas_scramble", [10, 20])).not.toBe(6);
  });

  it("3 players: 20/15/10 by CH ascending — sorts unsorted input", () => {
    // Seeded OUT OF ORDER [20, 10, 15]; must sort asc to [10, 15, 20]:
    //   0.2*10 + 0.15*15 + 0.1*20 = 2 + 2.25 + 2 = 6.25 → 6
    expect(computeTeamHandicap("texas_scramble", [20, 10, 15])).toBe(6);
    // Negative control: WITHOUT the ascending sort, applying weights in the
    // given order [20,15,10] → 0.2*20 + 0.15*15 + 0.1*10 = 4 + 2.25 + 1 = 7.25 → 7.
    expect(computeTeamHandicap("texas_scramble", [20, 10, 15])).not.toBe(7);
  });

  it("4 players: 20/15/10/5 by CH ascending", () => {
    // [4, 8, 12, 16] → 0.2*4 + 0.15*8 + 0.1*12 + 0.05*16
    //   = 0.8 + 1.2 + 1.2 + 0.8 = 4.0 → 4
    expect(computeTeamHandicap("texas_scramble", [16, 4, 12, 8])).toBe(4);
  });

  it("null member CH coalesces to 0 (lowest slot)", () => {
    // [null, 20] → [0, 20] → 0.35*0 + 0.15*20 = 3 → 3
    expect(computeTeamHandicap("texas_scramble", [null, 20])).toBe(3);
  });

  it("returns null for an unsupported team size", () => {
    expect(computeTeamHandicap("texas_scramble", [10])).toBeNull();
    expect(computeTeamHandicap("texas_scramble", [1, 2, 3, 4, 5])).toBeNull();
  });
});

describe("computeTeamHandicap — Alternate Shot", () => {
  it("(CH1 + CH2) / 2", () => {
    // [10, 20] → 30/2 = 15 → 15
    expect(computeTeamHandicap("alternate_shot", [10, 20])).toBe(15);
  });

  it(".5 ROUNDS UP", () => {
    // [10, 15] → 25/2 = 12.5 → 13 (half-up, not 12)
    expect(computeTeamHandicap("alternate_shot", [10, 15])).toBe(13);
    expect(computeTeamHandicap("alternate_shot", [10, 15])).not.toBe(12);
  });

  it("REJECTS 3+ players (and <2) → null", () => {
    expect(computeTeamHandicap("alternate_shot", [10, 15, 20])).toBeNull();
    expect(computeTeamHandicap("alternate_shot", [10, 15, 20, 25])).toBeNull();
    expect(computeTeamHandicap("alternate_shot", [10])).toBeNull();
  });
});

describe("computeTeamHandicap — non-team-card formats", () => {
  it("returns null (no team handicap applies)", () => {
    expect(computeTeamHandicap("2_ball", [10, 20])).toBeNull();
    expect(computeTeamHandicap("shambles", [10, 20])).toBeNull();
  });
});
