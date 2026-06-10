// GOLDEN-MASTER (Part 1) — freeze the canonical loadRoundResults output for a
// set of real finalized prod rounds, so NO scoring change can silently alter a
// known round. Each round is anchored to its LOCKED round_payouts (the
// independent truth) before the snapshot is trusted — we freeze the
// known-correct result, not whatever the code happens to emit.
//
// If a scoring change legitimately alters a golden, regenerate the snapshot
// (`vitest -u`) AND explain in the commit why the known round changed.

import { describe, it, expect, vi, beforeEach } from "vitest";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() { return fakeRef.current; },
}));

import { FakeSupabase } from "../../components/fake-supabase";
import { loadRoundResults } from "@/lib/round/results";
import { GOLDEN_ROUNDS } from "../../fixtures/goldenRounds";
import { round171 } from "../../fixtures/goldenRounds/data/round171";
import {
  buildFakeData,
  projectResults,
  assertRankingMatchesPayouts,
  assertGrossTotalsFromScores,
} from "../../fixtures/goldenRounds/build";

describe("golden-master: loadRoundResults on frozen prod rounds", () => {
  for (const { name, bundle } of GOLDEN_ROUNDS) {
    describe(name, () => {
      beforeEach(() => { fakeRef.current = new FakeSupabase(buildFakeData(bundle)); });

      // INDEPENDENT ANCHOR (every round): gross totals are pure summation of the
      // raw fixture scores — no scoring engine — so they confirm the frozen
      // snapshot was built from complete, correct score data (the TD33 class).
      it("player gross totals reconstruct from the raw scores (independent anchor)", async () => {
        const outcome = await loadRoundResults(bundle.round.id);
        expect(outcome.status).toBe("ok");
        if (outcome.status !== "ok") return;
        assertGrossTotalsFromScores(outcome.data, bundle);
      });

      // Stronger NET-ranking anchor where prod has locked payouts (round 171).
      if (bundle.payouts.length > 0) {
        it("net ranking is consistent with the locked round_payouts", async () => {
          const outcome = await loadRoundResults(bundle.round.id);
          expect(outcome.status).toBe("ok");
          if (outcome.status !== "ok") return;
          assertRankingMatchesPayouts(outcome.data, bundle.payouts);
        });
      }

      it("full canonical output matches the frozen snapshot (drift guard)", async () => {
        const outcome = await loadRoundResults(bundle.round.id);
        expect(outcome.status).toBe("ok");
        if (outcome.status !== "ok") return;
        expect(projectResults(outcome.data)).toMatchSnapshot();
      });
    });
  }
});

// Hand-derived spot checks — values confirmed against prod / the TD33 bug
// report, so the snapshot can never have frozen a wrong headline number.
describe("golden-master spot checks (hand-derived)", () => {
  beforeEach(() => { fakeRef.current = new FakeSupabase(buildFakeData(round171)); });

  it("round 171: winner Team 3 at −17, last Team 2 at +2 (matches payouts + TD33)", async () => {
    const outcome = await loadRoundResults(171);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    const byRank = [...outcome.data.teams].sort((a, b) => a.rank - b.rank);
    expect(byRank.map(t => ({ team: t.id, total: t.total }))).toEqual([
      { team: 3, total: -17 },
      { team: 1, total: -8 },
      { team: 4, total: -7 },
      { team: 2, total: 2 },
    ]);
    expect(byRank[0].totalLabel).toBe("−17");
  });
});
