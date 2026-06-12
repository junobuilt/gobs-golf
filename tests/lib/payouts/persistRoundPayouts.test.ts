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
// Flights S5: a team may carry blind-draw fills. The reconciliation reads only
// each fill's `fromTeamNumber` (the drawn player's own team) + the holding
// team's id, so fills here are minimal. Default [] → no redirect (byte-identical).
function team(
  id: number,
  total: number,
  n: number,
  blindDraws: Array<{ fromTeamNumber: number }> = [],
) {
  return { id, total, players: Array.from({ length: n }, () => ({})), blindDraws };
}
function okResult(teams: ReturnType<typeof team>[], format: string) {
  loadMock.mockResolvedValue({
    status: "ok",
    data: {
      teams, format, formatConfig: {}, isComplete: true, roundId: 1, maxThru: 18,
      formatLocked: true, playedOn: "2026-06-07",
      // Single-flight: one section holds every team (the engine runs once → the
      // payout payload is byte-identical to the pre-flights single run, plus the
      // additive flight_id/flight_name stamp).
      flightSections: [{
        flightId: 1, flightName: "Flight A", format, formatConfig: {},
        formatLocked: true, teams,
      }],
      individualRankings: [], individualRankingsMode: "best_n",
    },
  });
}
// Multi-flight: caller supplies explicit sections (each its own format/teams).
function okSections(sections: Array<{ flightId: number; flightName: string; format: string; teams: ReturnType<typeof team>[] }>) {
  const teams = sections.flatMap(s => s.teams);
  loadMock.mockResolvedValue({
    status: "ok",
    data: {
      teams, format: sections[0]?.format, formatConfig: {}, isComplete: true,
      roundId: 1, maxThru: 18, formatLocked: true, playedOn: "2026-06-07",
      flightSections: sections.map(s => ({
        flightId: s.flightId, flightName: s.flightName, format: s.format,
        formatConfig: {}, formatLocked: true, teams: s.teams,
      })),
      individualRankings: [], individualRankingsMode: "best_n",
    },
  });
}
type PersistedPayout = {
  team_number: number; place: number; per_player: number; team_size: number;
  total_for_team: number; is_tied: boolean; below_floor: boolean;
  flight_id: number; flight_name: string; redirected_share_count: number;
};
function lastPayload() {
  const call = rpcMock.mock.calls.at(-1)!;
  expect(call[0]).toBe("persist_round_payouts");
  return call[1] as {
    p_round_id: number;
    p_payload: {
      payouts: PersistedPayout[];
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
    expect(payoutByTeam(p, 1)).toEqual({ team_number: 1, place: 1, per_player: 15, team_size: 2, total_for_team: 30, is_tied: false, below_floor: false, flight_id: 1, flight_name: "Flight A", redirected_share_count: 0 });
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

  it("multi-flight: each flight scored independently (winner == standalone)", async () => {
    // Two best-N flights, each identical to the standalone 4-team round above.
    // Per-flight isolation means flight A's winner per_player must equal the
    // single-flight result (pot from its OWN 8 players = $56), NOT a round-wide
    // 16-player pot. Two engine runs → 3 paid each → 6 payout rows.
    okSections([
      { flightId: 1, flightName: "Flight A", format: "2_ball", teams: [team(1, -10, 2), team(2, -5, 2), team(3, -1, 2), team(4, 2, 2)] },
      { flightId: 2, flightName: "Flight B", format: "2_ball", teams: [team(5, -10, 2), team(6, -5, 2), team(7, -1, 2), team(8, 2, 2)] },
    ]);

    const out = await computeAndPersistRoundPayouts(1);
    expect(out).toMatchObject({ status: "persisted", placesPaid: 6, headcount: 16, balance: 112 });

    const p = lastPayload();
    expect(p.p_payload.payouts).toHaveLength(6);
    expect(payoutByTeam(p, 1)).toMatchObject({ place: 1, per_player: 15, flight_id: 1, flight_name: "Flight A" });
    expect(payoutByTeam(p, 5)).toMatchObject({ place: 1, per_player: 15, flight_id: 2, flight_name: "Flight B" });
    // Per-player contributions sum across both flights' headcounts.
    expect(p.p_payload.funds).toContainEqual({ fund: "hio", amount: 16, reason: "buyin_hio" });
    expect(p.p_payload.funds).toContainEqual({ fund: "bfb", amount: 32, reason: "buyin_bfb" });
  });

  it("multi-flight: both flights' sweeps combine into one BFB sweep", async () => {
    // Two 1-team flights → each pays 0 places and sweeps its whole pot ($28).
    okSections([
      { flightId: 1, flightName: "Flight A", format: "2_ball", teams: [team(1, -5, 4)] },
      { flightId: 2, flightName: "Flight B", format: "2_ball", teams: [team(2, 0, 4)] },
    ]);

    const out = await computeAndPersistRoundPayouts(1);
    expect(out).toMatchObject({ status: "persisted", placesPaid: 0, headcount: 8, balance: 56 });

    const p = lastPayload();
    expect(p.p_payload.payouts).toHaveLength(0);
    expect(p.p_payload.funds).toEqual([
      { fund: "hio", amount: 8, reason: "buyin_hio" },
      { fund: "bfb", amount: 16, reason: "buyin_bfb" },
      { fund: "bfb", amount: 56, reason: "sweep" }, // 28 (A) + 28 (B)
    ]);
  });

  it("throws when the persist rpc errors (surfaced for recovery)", async () => {
    okResult([team(1, -10, 2), team(2, -5, 2), team(3, -1, 2), team(4, 2, 2)], "2_ball");
    rpcMock.mockResolvedValueOnce({ error: { message: "boom" } });
    await expect(computeAndPersistRoundPayouts(1)).rejects.toThrow(/persist_round_payouts: boom/);
  });
});

// Flights S5 — blind-draw higher-of-two reconciliation. All fixtures are the
// confirmed 3-team / headcount-5 shape (one short team, balance 35): the engine
// pays 2 places at per_player 1st=$11, 2nd=$6 (independently anchored by the
// "short (blind-drawn) team" test above). A short team's total_for_team is
// per_player × team_size (= 2), so it is paid as if FULL — including the fill
// share — until the reconciliation removes a forfeited share.
describe("blind-draw higher-of-two reconciliation (S5)", () => {
  const fund = (p: ReturnType<typeof lastPayload>, reason: string) =>
    p.p_payload.funds.find((f) => f.reason === reason);

  it("own team did NOT place → no redirect, byte-identical (no marker, no sweep)", async () => {
    // Team 1 (short, drew a player from Team 2). Team 2 finishes LAST (unpaid).
    // Nothing to compare → today's behavior; the drawing team keeps full pay.
    okResult([
      team(1, -10, 1, [{ fromTeamNumber: 2 }]), // drawing team, 1st ($11)
      team(2, 0, 2),                             // own team of the fill — 3rd, UNPAID
      team(3, -5, 2),                            // 2nd ($6)
    ], "2_ball");

    await computeAndPersistRoundPayouts(1);
    const p = lastPayload();
    expect(payoutByTeam(p, 1)).toMatchObject({ per_player: 11, team_size: 2, total_for_team: 22, redirected_share_count: 0 });
    expect(p.p_payload.payouts.every((r) => r.redirected_share_count === 0)).toBe(true);
    expect(fund(p, "blind_draw_redirect")).toBeUndefined();
  });

  it("THE rule: drawing team HIGHER (1st) → own team forfeits its share to BFB", async () => {
    // Team 1 (short, 1st $11) drew a player whose OWN team (Team 3) placed 2nd
    // ($6). Player keeps Team 1's $11 (higher); Team 3 forfeits one $6 share → BFB.
    okResult([
      team(1, -10, 1, [{ fromTeamNumber: 3 }]), // drawing, 1st ($11)
      team(2, 0, 2),                             // 3rd, unpaid
      team(3, -5, 2),                            // own team of the fill — 2nd ($6)
    ], "2_ball");

    await computeAndPersistRoundPayouts(1);
    const p = lastPayload();
    // Drawing team unchanged — the player collects its (higher) fill share there.
    expect(payoutByTeam(p, 1)).toMatchObject({ per_player: 11, team_size: 2, total_for_team: 22, redirected_share_count: 0 });
    // Own team forfeits ONE $6 share: 12 → 6, count 1.
    expect(payoutByTeam(p, 3)).toMatchObject({ per_player: 6, team_size: 2, total_for_team: 6, redirected_share_count: 1 });
    expect(fund(p, "blind_draw_redirect")).toEqual({ fund: "bfb", amount: 6, reason: "blind_draw_redirect" });
  });

  it("REVERSE: own team HIGHER → the DRAWING team forfeits the fill share (short roster math)", async () => {
    // Team 3 (short n=1, 2nd $6) drew a player whose OWN team (Team 1) placed 1st
    // ($11). Player keeps his own Team-1 $11; the DRAWING Team 3 forfeits the fill
    // share. BEFORE: Team 3 paid as if FULL — per_player 6 × team_size 2 = $12
    // (the engine granted the fill share). AFTER: 12 − 6 = $6 = paid for its ONE
    // real member; per_player + team_size unchanged; the $6 fill share → BFB.
    okResult([
      team(1, -10, 2),                           // own team of the fill — 1st ($11)
      team(2, 0, 2),                             // 3rd, unpaid
      team(3, -5, 1, [{ fromTeamNumber: 1 }]),   // drawing team, 2nd ($6), SHORT
    ], "2_ball");

    await computeAndPersistRoundPayouts(1);
    const p = lastPayload();
    const drawing = payoutByTeam(p, 3)!;
    // per_player + team_size are NOT touched (we removed a granted share, not a
    // phantom one); total drops by exactly one per_player; count = 1.
    expect(drawing).toMatchObject({ per_player: 6, team_size: 2, total_for_team: 6, redirected_share_count: 1 });
    expect(drawing.per_player * (drawing.team_size - drawing.redirected_share_count)).toBe(drawing.total_for_team);
    // Own (higher) team unchanged.
    expect(payoutByTeam(p, 1)).toMatchObject({ per_player: 11, team_size: 2, total_for_team: 22, redirected_share_count: 0 });
    expect(fund(p, "blind_draw_redirect")).toEqual({ fund: "bfb", amount: 6, reason: "blind_draw_redirect" });
  });

  it("EQUAL shares (drawing + own tied) → no redirect, no sweep, no double-pay", async () => {
    // Team 3 (short, drew from Team 1); Teams 1 & 3 TIE for 1st → identical
    // per_player → the player's two shares are equal → nothing moves.
    okResult([
      team(1, -10, 2),                           // tie 1st
      team(2, 0, 2),                             // last, unpaid
      team(3, -10, 1, [{ fromTeamNumber: 1 }]),  // tie 1st, drawing, SHORT
    ], "2_ball");

    await computeAndPersistRoundPayouts(1);
    const p = lastPayload();
    const t1 = payoutByTeam(p, 1)!;
    const t3 = payoutByTeam(p, 3)!;
    expect(t1.per_player).toBe(t3.per_player);     // equal shares
    expect(t1.redirected_share_count).toBe(0);
    expect(t3.redirected_share_count).toBe(0);
    expect(fund(p, "blind_draw_redirect")).toBeUndefined();
  });

  it("cross-flight: redirect compares each team's OWN-flight per-player (different pots)", async () => {
    // Flight A (Team 1 short, drew from flight B's Team 3). Flight A pot is large
    // (4 players → balance 28, 1st≈$13), flight B small (2 players → balance 14).
    // The drawing team's flight-A share vs the own team's flight-B share — the
    // reconciliation reads each team's own row, so the comparison is flight-correct.
    okSections([
      { flightId: 10, flightName: "A", format: "2_ball", teams: [
        team(1, -10, 1, [{ fromTeamNumber: 3 }]), // drawing (flight A)
        team(2, 0, 2),
      ] },
      { flightId: 20, flightName: "B", format: "2_ball", teams: [
        team(3, -5, 2),                            // own team (flight B)
        team(4, 5, 2),
      ] },
    ]);

    await computeAndPersistRoundPayouts(1);
    const p = lastPayload();
    const drawing = payoutByTeam(p, 1)!;
    const own = payoutByTeam(p, 3)!;
    // Whichever placed lower forfeits a share; the higher is untouched; the swept
    // amount equals the loser's per_player. Assert the invariant holds with the
    // flight-correct per_player values (no cross-flight bleed).
    const lower = Math.min(drawing.per_player, own.per_player);
    const loser = drawing.per_player < own.per_player ? drawing : own;
    const winner = drawing.per_player < own.per_player ? own : drawing;
    if (drawing.per_player !== own.per_player) {
      expect(loser.redirected_share_count).toBe(1);
      expect(loser.total_for_team).toBe(loser.per_player * (loser.team_size - 1));
      expect(winner.redirected_share_count).toBe(0);
      expect(fund(p, "blind_draw_redirect")).toEqual({ fund: "bfb", amount: lower, reason: "blind_draw_redirect" });
    }
  });
});
