// Tournament handicap allowance (migration 042, reversal 2026-08-10). PURE.
//
// Policy: four-ball scales CH by the session allowance (null ⇒ 100%, back-compat
// so pre-042 scored four-ball is unchanged); singles is ALWAYS 100%; greensomes
// ignores the allowance (its own 60/40 team handicap). The allowance math is
// ONE shared helper (tournamentPlayingHandicap) consumed by BOTH the engine
// (sideHoleNets) and the loader/preview (computeSideStrokes) — the double-apply
// drift this branch had to avoid. Every expected value is hand-computed.

import { describe, it, expect } from "vitest";
import {
  resolveTournamentAllowance,
  tournamentPlayingHandicap,
  computeMatchState,
} from "@/lib/tournament/matchplay";
import { computeSideStrokes } from "@/lib/tournament/matchStrokes";
import type { HoleMeta, MatchInput, MatchPlayerInput } from "@/lib/tournament/types";

// 18 holes, par 4, stroke_index = hole number (SI 1 hardest).
function holes(): HoleMeta[] {
  return Array.from({ length: 18 }, (_, i) => ({ holeNumber: i + 1, par: 4, strokeIndex: i + 1 }));
}
function gross(scored: Record<number, number>): (number | null)[] {
  return Array.from({ length: 18 }, (_, i) => scored[i + 1] ?? null);
}
function player(id: number, ch: number | null, scored: Record<number, number>): MatchPlayerInput {
  return { playerId: id, courseHandicap: ch, gross: gross(scored) };
}

// ── Policy: resolveTournamentAllowance ──────────────────────────────────────
describe("resolveTournamentAllowance (per-format policy)", () => {
  it("singles_match is always 100% — the allowance column is ignored", () => {
    expect(resolveTournamentAllowance("singles_match", 90)).toBe(100);
    expect(resolveTournamentAllowance("singles_match", 50)).toBe(100);
    expect(resolveTournamentAllowance("singles_match", null)).toBe(100);
  });

  it("greensomes is always 100% on this path (60/40 team handicap ignores it)", () => {
    expect(resolveTournamentAllowance("greensomes", 90)).toBe(100);
    expect(resolveTournamentAllowance("greensomes", null)).toBe(100);
  });

  it("four_ball_match uses the session value, defaulting to 100% when unset (Decision A)", () => {
    expect(resolveTournamentAllowance("four_ball_match", 90)).toBe(90);
    expect(resolveTournamentAllowance("four_ball_match", 75)).toBe(75);
    expect(resolveTournamentAllowance("four_ball_match", null)).toBe(100); // back-compat
    expect(resolveTournamentAllowance("four_ball_match", undefined)).toBe(100);
  });
});

// ── Math: tournamentPlayingHandicap ─────────────────────────────────────────
describe("tournamentPlayingHandicap (round(CH × allowance / 100), null-safe)", () => {
  it("100% is the identity on the stored integer CH", () => {
    expect(tournamentPlayingHandicap(20, 100)).toBe(20);
    expect(tournamentPlayingHandicap(0, 100)).toBe(0);
  });

  it("90% rounds to the nearest whole stroke (.5 up)", () => {
    expect(tournamentPlayingHandicap(20, 90)).toBe(18); // 18.0
    expect(tournamentPlayingHandicap(15, 90)).toBe(14); // 13.5 → 14
    expect(tournamentPlayingHandicap(9, 90)).toBe(8); //  8.1 → 8
    expect(tournamentPlayingHandicap(10, 90)).toBe(9); //  9.0
  });

  it("null CH stays null", () => {
    expect(tournamentPlayingHandicap(null, 90)).toBeNull();
    expect(tournamentPlayingHandicap(null, 100)).toBeNull();
  });
});

// ── Engine: four-ball outcome moves with the allowance ──────────────────────
describe("four_ball_match: the allowance changes the hole outcome", () => {
  // Hole 1 (SI 1). A players CH 20 gross 5, CH 0 gross 6. B players CH 10 gross 4,
  // CH 0 gross 5. All match strokes are relative to the low unit (a CH-0 player),
  // so min PH = 0 in every case.
  //   100%: A0 PH20 → 2 strokes on SI1 → net 3; A best 3. B0 PH10 → 1 stroke →
  //         net 3; B best 3. ⇒ HALVED.
  //    90%: A0 PH18 → 1 stroke on SI1 → net 4; A best 4. B0 PH9 → 1 stroke →
  //         net 3; B best 3. ⇒ side_b.
  const base = {
    format: "four_ball_match" as const,
    holes: holes(),
    sideA: { side: "a" as const, players: [player(1, 20, { 1: 5 }), player(2, 0, { 1: 6 })] },
    sideB: { side: "b" as const, players: [player(3, 10, { 1: 4 }), player(4, 0, { 1: 5 })] },
  };

  it("null/absent allowance ⇒ 100% ⇒ the hole is HALVED (pre-042 behavior)", () => {
    const st = computeMatchState({ ...base } as MatchInput);
    expect(st.holeOutcomes[0]).toBe("halved");
    // explicit 100 is identical to absent
    const st100 = computeMatchState({ ...base, handicapAllowance: 100 } as MatchInput);
    expect(st100.holeOutcomes[0]).toBe("halved");
  });

  it("90% allowance ⇒ side_b wins the hole (A loses its second SI-1 stroke)", () => {
    const st = computeMatchState({ ...base, handicapAllowance: 90 } as MatchInput);
    expect(st.holeOutcomes[0]).toBe("side_b");
  });
});

// ── Engine: singles ignores the allowance ───────────────────────────────────
describe("singles_match: the allowance is ignored (always 100%)", () => {
  // Hole 15 (SI 15). A CH 18 gross 4, B CH 0 gross 4. At 100% A's PH 18 earns a
  // stroke on EVERY SI (base 1) → SI15 net 3 → side_a. Were the allowance wrongly
  // applied at 50%, PH 9 earns strokes only on SI ≤ 9, so SI15 would net 4 →
  // halved. So side_a on hole 15 at ANY allowance proves it is ignored.
  const base = {
    format: "singles_match" as const,
    holes: holes(),
    sideA: { side: "a" as const, players: [player(1, 18, { 15: 4 })] },
    sideB: { side: "b" as const, players: [player(2, 0, { 15: 4 })] },
  };

  it("side_a at 100%, 50%, and absent alike", () => {
    for (const allowance of [undefined, 100, 50]) {
      const st = computeMatchState({ ...base, handicapAllowance: allowance } as MatchInput);
      expect(st.holeOutcomes[14]).toBe("side_a");
    }
  });
});

// ── Loader/preview parity: computeSideStrokes applies the SAME policy ────────
describe("computeSideStrokes respects the allowance identically to the engine", () => {
  it("four_ball: 90% scales each CH before the low-unit subtraction", () => {
    // 90%: PHs [18,0,9,0], min 0 → aStrokes [18,0], bStrokes [9,0].
    const r90 = computeSideStrokes("four_ball_match", [20, 0], [10, 0], 90);
    expect(r90.aStrokes).toEqual([18, 0]);
    expect(r90.bStrokes).toEqual([9, 0]);
    // null ⇒ 100%: PHs [20,0,10,0], min 0 → aStrokes [20,0], bStrokes [10,0].
    const rNull = computeSideStrokes("four_ball_match", [20, 0], [10, 0], null);
    expect(rNull.aStrokes).toEqual([20, 0]);
    expect(rNull.bStrokes).toEqual([10, 0]);
  });

  it("singles: allowance is ignored — 50% matches 100%", () => {
    const r50 = computeSideStrokes("singles_match", [18], [0], 50);
    const r100 = computeSideStrokes("singles_match", [18], [0], 100);
    expect(r50.aStrokes).toEqual([18]);
    expect(r50.bStrokes).toEqual([0]);
    expect(r50).toEqual(r100);
  });

  it("greensomes: allowance is ignored — 60/40 team handicap regardless", () => {
    // Team A 5+15 → 9, Team B 10+20 → 14; min 9 → side strokes 0 and 5.
    const r50 = computeSideStrokes("greensomes", [5, 15], [10, 20], 50);
    const rNull = computeSideStrokes("greensomes", [5, 15], [10, 20], null);
    expect(r50.aCollapsed).toBe(9);
    expect(r50.bCollapsed).toBe(14);
    expect(r50.aSideStrokes).toBe(0);
    expect(r50.bSideStrokes).toBe(5);
    expect(r50).toEqual(rNull);
  });
});
