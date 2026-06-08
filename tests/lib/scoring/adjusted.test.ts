import { describe, it, expect } from "vitest";
import {
  netDoubleBogeyCap,
  computeAdjustedHoleScores,
  sumAdjusted,
} from "@/lib/scoring/adjusted";
import { getHandicapStrokes } from "@/lib/scoring/handicap";

describe("netDoubleBogeyCap", () => {
  it("par-5, 1 stroke received → cap = 5 + 2 + 1 = 8", () => {
    // rawCH=10 on stroke index 1 → 1 stroke received.
    expect(getHandicapStrokes(10, 1)).toBe(1);
    expect(netDoubleBogeyCap(5, 10, 1)).toBe(8);
  });

  it("par-3, 0 strokes received → cap = 3 + 2 + 0 = 5", () => {
    // rawCH=10 on stroke index 15 → 0 strokes received.
    expect(getHandicapStrokes(10, 15)).toBe(0);
    expect(netDoubleBogeyCap(3, 10, 15)).toBe(5);
  });

  it("ignores the allowance — cap uses the FULL (raw) handicap", () => {
    // The cap takes raw CH directly; an 80%-reduced CH (8) would give a
    // different stroke count on a boundary hole. We pass raw 22 → 2 strokes on
    // SI 1, cap = 4 + 2 + 2 = 8.
    expect(getHandicapStrokes(22, 1)).toBe(2);
    expect(netDoubleBogeyCap(4, 22, 1)).toBe(8);
  });
});

describe("computeAdjustedHoleScores (single-hole rule)", () => {
  it("caps a par-5 9 down to 8 (1 stroke), leaving actual untouched", () => {
    const adj = computeAdjustedHoleScores([9], [5], [1], 10);
    expect(adj).toEqual([8]);
  });

  it("caps a par-3 6 down to 5 (0 strokes)", () => {
    const adj = computeAdjustedHoleScores([6], [3], [15], 10);
    expect(adj).toEqual([5]);
  });

  it("leaves a hole at or under the cap unchanged (Adj equals actual)", () => {
    // par-4, 1 stroke → cap 7. A gross 5 is under the cap → unchanged.
    expect(computeAdjustedHoleScores([5], [4], [1], 10)).toEqual([5]);
    // A gross exactly at the cap (7) → unchanged.
    expect(computeAdjustedHoleScores([7], [4], [1], 10)).toEqual([7]);
  });

  it("passes null gross through as null (unplayed hole)", () => {
    expect(computeAdjustedHoleScores([null], [4], [1], 10)).toEqual([null]);
  });

  it("passes the actual score through when par or stroke index is missing", () => {
    expect(computeAdjustedHoleScores([12], [null], [1], 10)).toEqual([12]);
    expect(computeAdjustedHoleScores([12], [4], [null], 10)).toEqual([12]);
  });
});

describe("computeAdjustedHoleScores (full-18 golden fixture)", () => {
  // rawCH = 9 → strokes: SI 1..9 get 1, SI 10..18 get 0.
  // pars all 4. stroke indexes = hole order 1..18.
  // Caps: F9 holes (SI 1..9) = 4+2+1 = 7; B9 holes (SI 10..18) = 4+2+0 = 6.
  const RAW_CH = 9;
  const par = Array.from({ length: 18 }, () => 4);
  const si = Array.from({ length: 18 }, (_, i) => i + 1);

  // F9: all even par (4) — nothing caps (4 < 7).
  // B9: hole 10 is a blow-up 9 (caps to 6); the rest are par 4.
  const scores: (number | null)[] = Array.from({ length: 18 }, (_, i) =>
    i === 9 ? 9 : 4,
  );

  const adj = computeAdjustedHoleScores(scores, par, si, RAW_CH);

  const f9Actual = sumAdjusted(scores.slice(0, 9))!; // 36
  const b9Actual = sumAdjusted(scores.slice(9))!; // 41 (8×4 + 9)
  const totActual = sumAdjusted(scores)!; // 77

  const f9Adj = sumAdjusted(adj.slice(0, 9))!;
  const b9Adj = sumAdjusted(adj.slice(9))!;
  const totAdj = sumAdjusted(adj)!;

  it("the uncapped leg's Adj equals its actual (F9 = Adj F9 when nothing caps)", () => {
    expect(f9Actual).toBe(36);
    expect(f9Adj).toBe(36);
    expect(f9Adj).toBe(f9Actual);
  });

  it("Adj Tot = actual Tot − overage of the single capped hole (9→6 = 3)", () => {
    expect(totActual).toBe(77);
    expect(b9Adj).toBe(38); // 8×4 + 6
    expect(totAdj).toBe(74); // 77 − 3
    expect(totAdj).toBe(totActual - 3);
  });

  it("NEGATIVE CONTROL: Adj must not merely mirror actual — capping changed the total", () => {
    // If computeAdjustedHoleScores were a no-op, totAdj would equal totActual.
    expect(totAdj).not.toBe(totActual);
    expect(b9Adj).toBeLessThan(b9Actual);
    // And only the one blow-up hole changed.
    expect(adj[9]).toBe(6);
    expect(adj.filter((v, i) => v !== scores[i]).length).toBe(1);
  });
});
