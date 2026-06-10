// PROPERTY / INVARIANT TESTS (Part 3) — rules that must ALWAYS hold on
// loadRoundResults output, checked across the frozen golden rounds (varied
// formats, blind draws, override holes, mixed tees). These catch a class of
// regression broader than any single snapshot, and the negative controls prove
// the checks actually bite.

import { describe, it, expect, vi, beforeEach } from "vitest";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() { return fakeRef.current; },
}));

import { FakeSupabase } from "../../components/fake-supabase";
import { loadRoundResults, type LoadedRoundResults } from "@/lib/round/results";
import { isStablefordFormat } from "@/lib/leaderboard/rank";
import { GOLDEN_ROUNDS } from "../../fixtures/goldenRounds";
import { round171 } from "../../fixtures/goldenRounds/data/round171";
import {
  buildFakeData,
  assertRankingMatchesPayouts,
  assertGrossTotalsFromScores,
} from "../../fixtures/goldenRounds/build";

async function load(bundle: typeof round171): Promise<LoadedRoundResults> {
  fakeRef.current = new FakeSupabase(buildFakeData(bundle));
  const outcome = await loadRoundResults(bundle.round.id);
  if (outcome.status !== "ok") throw new Error("expected ok outcome");
  return outcome.data;
}

describe("engine invariants (across all golden rounds)", () => {
  for (const { name, bundle } of GOLDEN_ROUNDS) {
    describe(name, () => {
      it("ranks form a valid skip-tie permutation of 1..N", async () => {
        const data = await load(bundle);
        const ranks = data.teams.map(t => t.rank).sort((a, b) => a - b);
        const N = ranks.length;
        expect(ranks[0]).toBe(1); // a rank 1 always exists
        ranks.forEach((r, i) => {
          expect(r).toBeGreaterThanOrEqual(1);
          expect(r).toBeLessThanOrEqual(N);
          // skip-tie: each rank is either the previous rank (a tie) or its
          // 1-based position (e.g. 1, 2, 2, 4 — never 1, 2, 2, 3).
          if (i > 0) expect([ranks[i - 1], i + 1]).toContain(r);
        });
      });

      it("ranking is monotonic in total (best-N ascending / Stableford descending)", async () => {
        const data = await load(bundle);
        const stab = isStablefordFormat(data.format);
        const byRank = [...data.teams].sort((a, b) => a.rank - b.rank);
        for (let i = 1; i < byRank.length; i++) {
          if (byRank[i].rank === byRank[i - 1].rank) {
            expect(byRank[i].total).toBe(byRank[i - 1].total); // tie ⇒ equal total
          } else if (stab) {
            expect(byRank[i].total).toBeLessThanOrEqual(byRank[i - 1].total); // higher pts win
          } else {
            expect(byRank[i].total).toBeGreaterThanOrEqual(byRank[i - 1].total); // lower delta wins
          }
        }
      });

      it("F9 + B9 reconcile to the 18-hole total (where both legs exist)", async () => {
        const data = await load(bundle);
        for (const t of data.teams) {
          if (t.f9Total != null && t.b9Total != null) {
            expect(t.f9Total + t.b9Total).toBe(t.total);
          }
        }
      });

      it("every scored player's NET ≤ GROSS (non-negative handicaps, stroke formats)", async () => {
        const data = await load(bundle);
        if (isStablefordFormat(data.format)) return; // net is POINTS, not strokes
        for (const team of data.teams) {
          for (const p of team.players) {
            if (p.holesPlayed === 0) continue;
            expect(p.netTotal).toBeLessThanOrEqual(p.grossTotal);
          }
        }
      });

      it("a finalized round reads thru 18 (maxThru)", async () => {
        const data = await load(bundle);
        expect(data.maxThru).toBe(18);
      });

      it("gross totals reconstruct from raw scores (independent of the engine)", async () => {
        const data = await load(bundle);
        assertGrossTotalsFromScores(data, bundle); // throws on mismatch
      });
    });
  }
});

describe("invariant negative controls (the checks must bite)", () => {
  beforeEach(() => { /* fakeRef set per-test */ });

  it("removing the winning team's scores breaks the payout-ranking anchor", async () => {
    const team3rps = round171.round_players.filter(rp => rp.team_number === 3).map(rp => rp.id);
    const scrambled = { ...round171, scores: round171.scores.filter(([rpId]) => !team3rps.includes(rpId)) };
    fakeRef.current = new FakeSupabase(buildFakeData(scrambled));
    const outcome = await loadRoundResults(171);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    // Team 3 can no longer be 1st, so the ranking no longer matches payouts.
    expect(() => assertRankingMatchesPayouts(outcome.data, round171.payouts)).toThrow();
  });

  it("a TRUNCATED scores fetch (the TD33 mechanism) fails the gross anchor", async () => {
    // Simulate Supabase's row cap clipping a player mid-round: round_player 1210
    // keeps holes 1–14 but loses 15–18 (holesPlayed > 0, so it isn't skipped).
    const seed = buildFakeData(round171);
    seed.scores = seed.scores.filter(
      (s: any) => !(s.round_player_id === 1210 && s.hole_number >= 15),
    );
    fakeRef.current = new FakeSupabase(seed);
    const outcome = await loadRoundResults(171);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    // Engine gross (14 holes) ≠ the full 18-hole fixture-sum → caught.
    expect(() => assertGrossTotalsFromScores(outcome.data, round171)).toThrow();
  });
});
