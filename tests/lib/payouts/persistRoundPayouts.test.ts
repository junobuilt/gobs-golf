import { describe, it, expect, vi, beforeEach } from "vitest";

// Orchestration unit tests for computeAndPersistRoundPayouts. The Supabase
// client and loadRoundResults are mocked; the real payout engine runs. All
// fixtures start with NO persisted rows (the rpc is captured, never pre-seeded)
// so the code must do real work — assertions check the exact payload it builds.

const rpcMock = vi.hoisted(() =>
  vi.fn((..._args: any[]): Promise<{ error: { message: string } | null }> =>
    Promise.resolve({ error: null }),
  ),
);
const loadMock = vi.hoisted(() => vi.fn());
const buyInRow = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: rpcMock,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: buyInRow.value == null ? null : { value: buyInRow.value },
            }),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/round/results", () => ({ loadRoundResults: loadMock }));

import { computeAndPersistRoundPayouts } from "@/lib/payouts/persistRoundPayouts";

type T = { id: number; total: number; n: number };
function team(id: number, total: number, n: number) {
  return { id, total, players: Array.from({ length: n }, () => ({})) };
}
function okResult(teams: ReturnType<typeof team>[], format: string) {
  loadMock.mockResolvedValue({
    status: "ok",
    data: { teams, format, formatConfig: {}, isComplete: true, roundId: 1, maxThru: 18, formatLocked: true, playedOn: "2026-06-07" },
  });
}
function lastPayload() {
  const call = rpcMock.mock.calls.at(-1)!;
  expect(call[0]).toBe("persist_round_payouts");
  return call[1] as {
    p_round_id: number;
    p_payload: {
      payouts: Array<Record<string, unknown>>;
      funds: Array<{ fund: string; amount: number; reason: string }>;
    };
  };
}
function payoutByTeam(p: ReturnType<typeof lastPayload>, teamNumber: number) {
  return p.p_payload.payouts.find((r) => r.team_number === teamNumber);
}

beforeEach(() => {
  rpcMock.mockClear();
  loadMock.mockReset();
  buyInRow.value = null; // default → buy-in 10
});

describe("computeAndPersistRoundPayouts", () => {
  it("normal 4-team best-N round: 3 places paid, funds credited", async () => {
    okResult([team(1, -10, 2), team(2, -5, 2), team(3, -1, 2), team(4, 2, 2)], "2_ball");

    const out = await computeAndPersistRoundPayouts(101);
    expect(out).toMatchObject({ status: "persisted", placesPaid: 3, headcount: 8, balance: 56, teamSize: 2 });

    const p = lastPayload();
    expect(p.p_round_id).toBe(101);
    expect(p.p_payload.payouts).toHaveLength(3); // team 4 (4th of 4, only 3 paid) excluded
    expect(payoutByTeam(p, 1)).toEqual({ team_number: 1, place: 1, per_player: 15, team_size: 2, total_for_team: 30, is_tied: false, below_floor: false });
    expect(payoutByTeam(p, 2)).toMatchObject({ place: 2, per_player: 8, total_for_team: 16 });
    expect(payoutByTeam(p, 3)).toMatchObject({ place: 3, per_player: 5, total_for_team: 10 });
    // sweep is 0 here → no sweep fund row
    expect(p.p_payload.funds).toEqual([
      { fund: "hio", amount: 8, reason: "buyin_hio" },
      { fund: "bfb", amount: 16, reason: "buyin_bfb" },
    ]);
  });

  it("short (blind-drawn) team: players = num_teams * team_size, NOT headcount", async () => {
    // 3 teams, team_size 2, but team 3 has 1 real player (1 blind-draw fill).
    // headcount = 5. Negative control: passing headcount=5 → floor(5/2)=2 teams
    // → 1 place. Correct derivation → 3 teams → 2 places.
    okResult([team(1, -5, 2), team(2, -2, 2), team(3, 3, 1)], "2_ball");

    const out = await computeAndPersistRoundPayouts(149);
    expect(out).toMatchObject({ status: "persisted", placesPaid: 2, headcount: 5, balance: 35 });

    const p = lastPayload();
    expect(p.p_payload.payouts).toHaveLength(2); // <- would be 1 if headcount were passed
    expect(payoutByTeam(p, 1)).toMatchObject({ place: 1, per_player: 11, total_for_team: 22 });
    expect(payoutByTeam(p, 2)).toMatchObject({ place: 2, per_player: 6, total_for_team: 12 });
    expect(p.p_payload.funds).toEqual([
      { fund: "hio", amount: 5, reason: "buyin_hio" },
      { fund: "bfb", amount: 10, reason: "buyin_bfb" },
      { fund: "bfb", amount: 1, reason: "sweep" },
    ]);
  });

  it("tie at 1st: two rows at place 1, is_tied true, combined-and-split", async () => {
    okResult([team(1, -10, 2), team(2, -10, 2), team(3, -3, 2), team(4, 0, 2)], "2_ball");

    await computeAndPersistRoundPayouts(1);
    const p = lastPayload();
    const place1 = p.p_payload.payouts.filter((r) => r.place === 1);
    expect(place1).toHaveLength(2);
    expect(place1.every((r) => r.is_tied === true && r.per_player === 11)).toBe(true);
    expect(payoutByTeam(p, 3)).toMatchObject({ place: 3, per_player: 5, is_tied: false });
    // combined 1st+2nd ($46) → $11/player ($44 paid) leaves $2 over + 3rd intact:
    expect(p.p_payload.funds).toContainEqual({ fund: "bfb", amount: 2, reason: "sweep" });
  });

  it("below-floor tie at the cutoff carries below_floor=true", async () => {
    // 6 teams, team_size 2; teams 4 & 5 tie at the 4th-place cutoff. The 4th
    // pot ($10) splits to $2/player — below the $5 floor.
    okResult(
      [team(1, -10, 2), team(2, -8, 2), team(3, -6, 2), team(4, -4, 2), team(5, -4, 2), team(6, 0, 2)],
      "2_ball",
    );

    await computeAndPersistRoundPayouts(1);
    const p = lastPayload();
    const place4 = p.p_payload.payouts.filter((r) => r.place === 4);
    expect(place4).toHaveLength(2);
    expect(place4.every((r) => r.below_floor === true && r.per_player === 2 && r.is_tied === true)).toBe(true);
    // higher places are above floor:
    expect(payoutByTeam(p, 1)).toMatchObject({ below_floor: false });
  });

  it("fewer than 2 teams: no payouts, but funds still credited (full sweep)", async () => {
    okResult([team(1, -5, 4)], "2_ball");

    const out = await computeAndPersistRoundPayouts(1);
    expect(out).toMatchObject({ status: "persisted", placesPaid: 0, headcount: 4, balance: 28 });

    const p = lastPayload();
    expect(p.p_payload.payouts).toHaveLength(0);
    expect(p.p_payload.funds).toEqual([
      { fund: "hio", amount: 4, reason: "buyin_hio" },
      { fund: "bfb", amount: 8, reason: "buyin_bfb" },
      { fund: "bfb", amount: 28, reason: "sweep" }, // whole pot sweeps
    ]);
  });

  it("Stableford ranks by highest total (sort direction)", async () => {
    // Negative control: best_n would crown the lowest (team 1); Stableford
    // crowns the highest (team 2).
    okResult([team(1, 20, 2), team(2, 45, 2), team(3, 30, 2)], "gobs_stableford");

    await computeAndPersistRoundPayouts(1);
    const p = lastPayload();
    expect(payoutByTeam(p, 2)).toMatchObject({ place: 1, per_player: 14 });
    expect(payoutByTeam(p, 3)).toMatchObject({ place: 2, per_player: 7 });
    expect(payoutByTeam(p, 1)).toBeUndefined(); // lowest points → out of the money
  });

  it("buy-in is read from league_settings; HIO/BFB stay fixed per player", async () => {
    buyInRow.value = "15";
    okResult([team(1, -10, 2), team(2, -5, 2), team(3, -1, 2), team(4, 2, 2)], "2_ball");

    const out = await computeAndPersistRoundPayouts(1);
    expect(out).toMatchObject({ balance: 96, headcount: 8 }); // (15-3)*8

    const p = lastPayload();
    // HIO/BFB contributions are headcount-based, independent of buy-in:
    expect(p.p_payload.funds).toContainEqual({ fund: "hio", amount: 8, reason: "buyin_hio" });
    expect(p.p_payload.funds).toContainEqual({ fund: "bfb", amount: 16, reason: "buyin_bfb" });
  });

  it("Shambles is a paid best-N format: lowest net total wins, payouts + funds persisted", async () => {
    // Wave 1B follow-up GATE — a finalized Shambles round must reach payout
    // persistence (round_payouts + fund_transactions, both written by the single
    // persist_round_payouts payload below), not merely flip is_complete. Proves
    // the engine ranks Shambles as best_n. Negative control vs Stableford:
    // best_n crowns the LOWEST total (team 1); Stableford would crown the highest.
    okResult([team(1, -8, 2), team(2, -3, 2), team(3, 1, 2), team(4, 5, 2)], "shambles");

    const out = await computeAndPersistRoundPayouts(120);
    expect(out).toMatchObject({ status: "persisted", placesPaid: 3, headcount: 8, balance: 56, teamSize: 2 });

    const p = lastPayload();
    expect(p.p_round_id).toBe(120);
    expect(p.p_payload.payouts.length).toBeGreaterThan(0);
    expect(payoutByTeam(p, 1)).toMatchObject({ place: 1 }); // lowest net wins
    expect(payoutByTeam(p, 4)).toBeUndefined();             // 4th of 4 → out of the money
    // Funds → fund_transactions rows, always credited at finalize:
    expect(p.p_payload.funds).toEqual([
      { fund: "hio", amount: 8, reason: "buyin_hio" },
      { fund: "bfb", amount: 16, reason: "buyin_bfb" },
    ]);
  });

  it("unsupported team size → skipped, no rpc", async () => {
    okResult([team(1, -5, 5), team(2, 0, 5)], "2_ball");
    const out = await computeAndPersistRoundPayouts(1);
    expect(out).toEqual({ status: "skipped", reason: "unsupported_team_size_5" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("loadRoundResults not ok → skipped, no rpc", async () => {
    loadMock.mockResolvedValue({ status: "missing_round" });
    const out = await computeAndPersistRoundPayouts(1);
    expect(out).toEqual({ status: "skipped", reason: "missing_round" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("throws when the persist rpc errors (surfaced for recovery)", async () => {
    okResult([team(1, -10, 2), team(2, -5, 2), team(3, -1, 2), team(4, 2, 2)], "2_ball");
    rpcMock.mockResolvedValueOnce({ error: { message: "boom" } });
    await expect(computeAndPersistRoundPayouts(1)).rejects.toThrow(/persist_round_payouts: boom/);
  });
});
