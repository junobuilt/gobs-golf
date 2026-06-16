import { describe, it, expect, vi } from "vitest";

// computePairMatrix is pure; it doesn't touch supabase, but compute.ts imports
// supabase at module level so we stub it to avoid the missing-env-var crash.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { computePairMatrix } from "@/lib/playedWith/compute";
import type { RoundPlayerRow } from "@/lib/playedWith/compute";

describe("computePairMatrix", () => {
  it("never-played pair returns 0", () => {
    const rpRows: RoundPlayerRow[] = [
      { round_id: 1, team_number: 1, player_id: 1 },
      { round_id: 1, team_number: 2, player_id: 2 }, // different teams
    ];
    const m = computePairMatrix(rpRows);
    expect(m(1, 2)).toBe(0);
  });

  it("returns 0 for a pair that simply never appears", () => {
    const m = computePairMatrix([]);
    expect(m(99, 100)).toBe(0);
  });

  it("counts one shared round", () => {
    const rpRows: RoundPlayerRow[] = [
      { round_id: 1, team_number: 1, player_id: 10 },
      { round_id: 1, team_number: 1, player_id: 20 },
    ];
    const m = computePairMatrix(rpRows);
    expect(m(10, 20)).toBe(1);
  });

  it("is symmetric", () => {
    const rpRows: RoundPlayerRow[] = [
      { round_id: 1, team_number: 1, player_id: 5 },
      { round_id: 1, team_number: 1, player_id: 7 },
    ];
    const m = computePairMatrix(rpRows);
    expect(m(5, 7)).toBe(m(7, 5));
  });

  it("counts multiple rounds together", () => {
    // A and B on the same team in 2 different rounds.
    const rpRows: RoundPlayerRow[] = [
      { round_id: 1, team_number: 1, player_id: 1 },
      { round_id: 1, team_number: 1, player_id: 2 },
      { round_id: 2, team_number: 1, player_id: 1 },
      { round_id: 2, team_number: 1, player_id: 2 },
    ];
    const m = computePairMatrix(rpRows);
    expect(m(1, 2)).toBe(2);
  });

  it("different teams same round does not count as a pairing", () => {
    // A on team 1, B on team 2, same round.
    const rpRows: RoundPlayerRow[] = [
      { round_id: 1, team_number: 1, player_id: 1 },
      { round_id: 1, team_number: 2, player_id: 2 },
    ];
    const m = computePairMatrix(rpRows);
    expect(m(1, 2)).toBe(0);
  });

  it("handles a team of 3 — emits all 3 pairs", () => {
    const rpRows: RoundPlayerRow[] = [
      { round_id: 1, team_number: 1, player_id: 1 },
      { round_id: 1, team_number: 1, player_id: 2 },
      { round_id: 1, team_number: 1, player_id: 3 },
    ];
    const m = computePairMatrix(rpRows);
    expect(m(1, 2)).toBe(1);
    expect(m(1, 3)).toBe(1);
    expect(m(2, 3)).toBe(1);
  });
});
