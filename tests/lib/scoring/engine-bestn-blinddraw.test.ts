import { describe, it, expect } from "vitest";
import { computeRoundResult } from "@/lib/scoring/engine";
import type { HoleInfo } from "@/lib/scoring/types";

// ─── Best-N team total includes blind-draw fills (D.1 follow-up) ────────────
// Rounds 101/118/141/147/161 shipped wrong because the engine ignored
// blind_draws fills for best-N formats entirely (the per-hole pool was the
// team roster only). These tests pin the corrected contract:
//   - A blind-draw fill is a full member of the per-hole "best of" pool: it
//     can be selected as a contributing ball, and on override ("all scores
//     count") holes it counts unconditionally — including over par.
//   - The fill's effect lands in perHole[h].teamScore + contributingPlayerIds
//     (which scales teamParAtScored). blindDrawTotal stays 0 for best-N.
//   - The fill's net uses the DRAWN player's own tee stroke-index, not the
//     short team's.
//
// Negative control (fixtures must not accidentally pass): every fill score is
// chosen so the fill changes the selected ball. Without the new engine code
// the blindDraws are ignored and every assertion below would fail — i.e. the
// tests do real work.

// 18 par-4 holes, strokeIndex = holeNumber (1..18).
function par4Holes(): HoleInfo[] {
  return Array.from({ length: 18 }, (_, i) => ({
    holeNumber: i + 1,
    par: 4,
    strokeIndex: i + 1,
  }));
}

function scoresAll(v: number): Record<number, number> {
  const o: Record<number, number> = {};
  for (let h = 1; h <= 18; h++) o[h] = v;
  return o;
}

function scoresRange(v: number, start: number, end: number): Record<number, number> {
  const o: Record<number, number> = {};
  for (let h = start; h <= end; h++) o[h] = v;
  return o;
}

describe("computeRoundResult — best-N with blind draws", () => {
  it("Best Ball (N=1): 1-player team + 1 fill picks best-1 across 2 players per hole", () => {
    const holes = par4Holes();
    const result = computeRoundResult({
      format: "best_ball",
      formatConfig: { basis: "net", best_n: 1, override_holes: [] },
      holes,
      players: [{ playerId: "A", courseHandicap: 0, grossScores: scoresAll(5) }],
      blindDraws: [
        {
          drawnPlayerId: "D",
          drawnPlayerCourseHandicap: 0,
          drawnPlayerScores: scoresAll(3),
          drawnPlayerHoles: holes,
          holeRangeStart: 1,
          holeRangeEnd: 18,
        },
      ],
    });

    // best-1 of {A=5, D=3} = D=3 on every hole → 54. (Would be 90 — A only —
    // if fills were ignored.)
    expect(result.teamScore).toBe(54);
    expect(result.teamParAtScored).toBe(72); // 1 contributor × par 4 × 18
    expect(result.blindDrawTotal).toBe(0); // best-N effect is in teamScore, not here
    const h1 = result.perHole.find(h => h.holeNumber === 1)!.result;
    expect(h1.contributingPlayerIds).toEqual(["D"]);
  });

  it("2-Ball (N=2): 3-player team + 1 fill picks best-2 across 4 players per hole", () => {
    const holes = par4Holes();
    const result = computeRoundResult({
      format: "2_ball",
      formatConfig: { basis: "net", best_n: 2, override_holes: [] },
      holes,
      players: [
        { playerId: "A", courseHandicap: 0, grossScores: scoresAll(4) },
        { playerId: "B", courseHandicap: 0, grossScores: scoresAll(5) },
        { playerId: "C", courseHandicap: 0, grossScores: scoresAll(6) },
      ],
      blindDraws: [
        {
          drawnPlayerId: "D",
          drawnPlayerCourseHandicap: 0,
          drawnPlayerScores: scoresAll(3),
          drawnPlayerHoles: holes,
          holeRangeStart: 1,
          holeRangeEnd: 18,
        },
      ],
    });

    // best-2 of {A=4, B=5, C=6, D=3} = D=3 + A=4 = 7 per hole → 126. (Would be
    // 162 — A+B — if fills were ignored.)
    expect(result.teamScore).toBe(126);
    expect(result.teamParAtScored).toBe(144); // 2 contributors × par 4 × 18
    const h1 = result.perHole.find(h => h.holeNumber === 1)!.result;
    expect(h1.contributingPlayerIds).toEqual(["D", "A"]);
    expect(h1.perPlayer.find(p => p.playerId === "B")?.isContributing).toBe(false);
    expect(h1.perPlayer.find(p => p.playerId === "C")?.isContributing).toBe(false);
  });

  it("3-Ball (N=3): 2-player team + 1 fill picks best-3 across 3 players per hole", () => {
    const holes = par4Holes();
    const result = computeRoundResult({
      format: "3_ball",
      formatConfig: { basis: "net", best_n: 3, override_holes: [] },
      holes,
      players: [
        { playerId: "A", courseHandicap: 0, grossScores: scoresAll(4) },
        { playerId: "B", courseHandicap: 0, grossScores: scoresAll(5) },
      ],
      blindDraws: [
        {
          drawnPlayerId: "D",
          drawnPlayerCourseHandicap: 0,
          drawnPlayerScores: scoresAll(6),
          drawnPlayerHoles: holes,
          holeRangeStart: 1,
          holeRangeEnd: 18,
        },
      ],
    });

    // best-3 of {A=4, B=5, D=6} = all 3 = 15 per hole → 270. Without the fill
    // the team has only 2 scores, can't satisfy best-3, so every hole would be
    // unscored → teamScore null.
    expect(result.teamScore).toBe(270);
    expect(result.holesScored).toBe(18);
    expect(result.teamParAtScored).toBe(216); // 3 contributors × par 4 × 18
    const h1 = result.perHole.find(h => h.holeNumber === 1)!.result;
    expect(h1.contributingPlayerIds).toHaveLength(3);
    expect(new Set(h1.contributingPlayerIds)).toEqual(new Set(["A", "B", "D"]));
  });

  it("Mid-round dropout: 1 active + dropout(thru 9) + fill(10-18) replaces the dropout", () => {
    const holes = par4Holes();
    const result = computeRoundResult({
      format: "2_ball",
      formatConfig: { basis: "net", best_n: 2, override_holes: [] },
      holes,
      players: [
        { playerId: "A", courseHandicap: 0, grossScores: scoresAll(4) },
        // B walked off after hole 9 — no scores on 10..18.
        { playerId: "B", courseHandicap: 0, grossScores: scoresRange(5, 1, 9) },
      ],
      blindDraws: [
        {
          drawnPlayerId: "D",
          drawnPlayerCourseHandicap: 0,
          drawnPlayerScores: scoresRange(3, 10, 18),
          drawnPlayerHoles: holes,
          holeRangeStart: 10, // fill only covers the dropout's missing holes
          holeRangeEnd: 18,
        },
      ],
    });

    // Holes 1-9: best-2 {A=4, B=5} = 9 ×9 = 81. Holes 10-18: best-2 {A=4, D=3}
    // = 7 ×9 = 63. Total 144 over 18 holes. Without the fill, holes 10-18 have
    // only A's score → can't make best-2 → only 9 holes scored, total 81.
    expect(result.teamScore).toBe(144);
    expect(result.holesScored).toBe(18);
    const h5 = result.perHole.find(h => h.holeNumber === 5)!.result;
    expect(h5.contributingPlayerIds).toEqual(["A", "B"]);
    const h12 = result.perHole.find(h => h.holeNumber === 12)!.result;
    expect(h12.contributingPlayerIds).toEqual(["D", "A"]);
  });

  it("Override holes [9,18]: all-scores-count includes the fill, even over par", () => {
    const holes = par4Holes();
    const result = computeRoundResult({
      format: "best_ball",
      formatConfig: { basis: "net", best_n: 1, override_holes: [9, 18] },
      holes,
      players: [{ playerId: "A", courseHandicap: 0, grossScores: scoresAll(5) }],
      blindDraws: [
        {
          drawnPlayerId: "D",
          drawnPlayerCourseHandicap: 0,
          drawnPlayerScores: scoresAll(3),
          drawnPlayerHoles: holes,
          holeRangeStart: 1,
          holeRangeEnd: 18,
        },
      ],
    });

    // 16 non-override holes: best-1 {A=5, D=3} = 3 → 48. Holes 9 & 18 (override,
    // all count): A=5 + D=3 = 8 each → 16. Total 64. (Would be 90 — A only —
    // if fills were ignored.)
    expect(result.teamScore).toBe(64);
    // par: 16 holes × 4 × 1 contributor + 2 holes × 4 × 2 contributors = 80.
    expect(result.teamParAtScored).toBe(80);
    const h1 = result.perHole.find(h => h.holeNumber === 1)!.result;
    expect(h1.contributingPlayerIds).toEqual(["D"]); // normal best-1 hole
    const h9 = result.perHole.find(h => h.holeNumber === 9)!.result;
    expect(h9.contributingPlayerIds).toEqual(["A", "D"]); // override: both count
    expect(h9.teamScore).toBe(8);
  });

  it("Fill net uses the DRAWN player's own tee stroke-index, not the team's", () => {
    // Team A's tee: strokeIndex = holeNumber. Drawn D's tee: strokeIndex
    // reversed (19 - holeNumber). D has CH 1, so D gets its single stroke on
    // the hole where D's SI == 1 → D's hole 18 (not hole 1).
    const teamHoles: HoleInfo[] = Array.from({ length: 18 }, (_, i) => ({
      holeNumber: i + 1,
      par: 4,
      strokeIndex: i + 1,
    }));
    const drawnHoles: HoleInfo[] = Array.from({ length: 18 }, (_, i) => ({
      holeNumber: i + 1,
      par: 4,
      strokeIndex: 19 - (i + 1),
    }));

    const result = computeRoundResult({
      format: "best_ball",
      formatConfig: { basis: "net", best_n: 1, override_holes: [] },
      holes: teamHoles,
      // A always nets 10 so the fill is always the chosen ball.
      players: [{ playerId: "A", courseHandicap: 0, grossScores: scoresAll(10) }],
      blindDraws: [
        {
          drawnPlayerId: "D",
          drawnPlayerCourseHandicap: 1,
          drawnPlayerScores: scoresAll(4),
          drawnPlayerHoles: drawnHoles,
          holeRangeStart: 1,
          holeRangeEnd: 18,
        },
      ],
    });

    // Hole 1: D's SI = 18 → no stroke → net 4. Hole 18: D's SI = 1 → 1 stroke
    // → net 3. If the engine wrongly used the team's tee, these would swap.
    expect(result.perHole.find(h => h.holeNumber === 1)!.result.teamScore).toBe(4);
    expect(result.perHole.find(h => h.holeNumber === 18)!.result.teamScore).toBe(3);
  });
});
