// Flights cross-surface agreement (Session 1). Format/config/allowance moved
// from `rounds` to the round's primary flight. These tests assert the surfaces
// that read format AGREE on the SAME flight value (EQUAL, not just each-loads),
// that the one allowance accessor reads off the flight, and — the negative
// control — that mutating the frozen rounds.* columns changes NOTHING in the
// resolved output (proving reads moved off `rounds`).

import { describe, it, expect, beforeEach, vi } from "vitest";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() { return fakeRef.current; },
}));

import { FakeSupabase, buildSeed, type FakeData } from "../../components/fake-supabase";
import { loadRoundResults } from "@/lib/round/results";
import { getPrimaryFlightForRound } from "@/lib/flights/resolve";
import {
  allowsIncompleteClose,
  getHandicapAllowance,
  getPlayingCourseHandicap,
} from "@/lib/format/helpers";

describe("cross-surface: format resolution agrees across surfaces", () => {
  beforeEach(() => { fakeRef.current = new FakeSupabase(buildSeed()); });

  it("scorecard/finalize source == leaderboard/results source == the flight format (EQUAL)", async () => {
    // (a) getPrimaryFlightForRound — what the scorecard load, RoundSetup, and
    //     the finalize-RPC-choice site all read.
    const flightFormat = (await getPrimaryFlightForRound(1))?.format ?? null;
    // (b) loadRoundResults — what /leaderboard + RoundResultsView render from.
    const outcome = await loadRoundResults(1);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;

    expect(flightFormat).toBe("2_ball");          // the seeded flight format
    expect(outcome.data.format).toBe(flightFormat); // EQUAL across the two paths
    // The finalize-RPC choice derives from the SAME flight format, so the
    // relaxed-vs-blind-draw decision is identical on both surfaces.
    expect(allowsIncompleteClose(flightFormat)).toBe(allowsIncompleteClose(outcome.data.format));
    expect(allowsIncompleteClose(flightFormat)).toBe(false); // 2_ball → blind-draw path
  });

  it("the finalize-RPC choice tracks the flight format (Shambles → relaxed)", async () => {
    // Seed a Shambles flight; the choice must flip to the relaxed close.
    const seed = buildSeed();
    seed.rounds[0].format = "shambles";
    seed.rounds[0].format_config = { basis: "net", scoring_basis: "net", team_ball_count: 1, override_holes: [] };
    fakeRef.current = new FakeSupabase(seed); // auto-derives the flight from the round

    const flightFormat = (await getPrimaryFlightForRound(1))?.format ?? null;
    expect(flightFormat).toBe("shambles");
    expect(allowsIncompleteClose(flightFormat)).toBe(true); // relaxed finalize path
  });
});

describe("cross-surface: the single allowance accessor reads off the FLIGHT", () => {
  it("caption (getHandicapAllowance) and net scaling (getPlayingCourseHandicap) read the same flight allowance, NOT rounds.format_config", async () => {
    // Flight says 80%; the frozen rounds.format_config deliberately says 100%.
    // Reading the round would give 100 — reading the flight gives 80.
    const seed: FakeData = buildSeed();
    seed.rounds[0].format_config = { basis: "net", best_n: 2, override_holes: [], handicap_allowance: 100 };
    seed.flights = [
      { id: 5001, round_id: 1, name: "Flight A", sort_order: 1, format: "2_ball",
        format_config: { basis: "net", scoring_basis: "net", best_n: 2, override_holes: [], handicap_allowance: 80 },
        format_locked_at: "2026-05-13T00:00:00Z" },
    ];
    fakeRef.current = new FakeSupabase(seed);

    const flightCfg = (await getPrimaryFlightForRound(1))?.format_config ?? null;

    // The caption reads getHandicapAllowance(flightConfig)…
    expect(getHandicapAllowance(flightCfg)).toBe(80);
    // …and net stroke allocation reads getPlayingCourseHandicap(ch, flightConfig)
    // off the SAME config — CH 13 @ 80% → 10. One source, no drift.
    expect(getPlayingCourseHandicap(13, flightCfg)).toBe(10);

    // Proof it's the flight, not the frozen round: the round's 100% would give 13.
    expect(getPlayingCourseHandicap(13, seed.rounds[0].format_config as any)).toBe(13);
  });
});

describe("negative control: mutating frozen rounds.* changes nothing in resolved output", () => {
  it("loadRoundResults output is unchanged after rounds.format is mutated (reads moved to the flight)", async () => {
    const fake = new FakeSupabase(buildSeed()); // flight auto-derived from the round (2_ball)
    fakeRef.current = fake;

    const before = await loadRoundResults(1);
    expect(before.status).toBe("ok");
    if (before.status !== "ok") return;
    expect(before.data.format).toBe("2_ball");

    // Mutate the FROZEN legacy column. The flight was snapshotted at construction
    // and is what results.ts reads — so the resolved format must NOT change.
    fake.data.rounds[0].format = "gobs_stableford";
    fake.data.rounds[0].format_config = { basis: "net", point_values: { par: 99 } };

    const after = await loadRoundResults(1);
    expect(after.status).toBe("ok");
    if (after.status !== "ok") return;

    expect(after.data.format).toBe("2_ball");          // unchanged
    expect(after.data.format).toBe(before.data.format); // EQUAL to pre-mutation
    expect((await getPrimaryFlightForRound(1))?.format).toBe("2_ball");
  });
});
