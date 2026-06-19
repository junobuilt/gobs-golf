import { describe, it, expect, vi, beforeEach } from "vitest";

// Lib-level tests for the read-only Winnings data layer. A small purpose-built
// supabase mock honors the chains the lib uses (eq incl. dotted embed filters,
// in, gt, order, limit) so query contracts + money derivations are exercised
// with negative-control fixtures (out-of-order txns; a row that must be season-
// filtered out).

const dataRef = vi.hoisted(() => ({ current: {} as Record<string, any[]> }));

vi.mock("@/lib/supabase", () => {
  function get(row: any, path: string) {
    return path.split(".").reduce((o, k) => (o == null ? o : o[k]), row);
  }
  class Builder {
    private eqs: Array<[string, any]> = [];
    private ins: [string, any[]] | null = null;
    private gts: Array<[string, any]> = [];
    private ord: { col: string; asc: boolean } | null = null;
    private lim: number | null = null;
    constructor(private table: string) {}
    select() { return this; }
    eq(col: string, val: any) { this.eqs.push([col, val]); return this; }
    in(col: string, vals: any[]) { this.ins = [col, vals]; return this; }
    gt(col: string, val: any) { this.gts.push([col, val]); return this; }
    order(col: string, opts?: any) { this.ord = { col, asc: opts?.ascending ?? true }; return this; }
    limit(n: number) { this.lim = n; return this; }
    private run() {
      let rows = [...(dataRef.current[this.table] ?? [])];
      for (const [c, v] of this.eqs) rows = rows.filter((r) => get(r, c) === v);
      if (this.ins) rows = rows.filter((r) => this.ins![1].includes(get(r, this.ins![0])));
      for (const [c, v] of this.gts) rows = rows.filter((r) => get(r, c) > v);
      if (this.ord) {
        const { col, asc } = this.ord;
        rows.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
      }
      if (this.lim != null) rows = rows.slice(0, this.lim);
      return { data: rows, error: null };
    }
    then<T>(onF: (v: { data: any; error: any }) => T) { return Promise.resolve(this.run()).then(onF); }
  }
  return { supabase: { from: (t: string) => new Builder(t) } };
});

import {
  loadFundBalances,
  loadRecentFundTransactions,
  loadWinningsHistory,
  winningsToCsv,
  deriveRoundMoney,
  resolveBuyIn,
} from "@/lib/payouts/loadWinnings";

function seedHistory() {
  // round 501: season 1, 2-Ball, 24 plyrs / 12 teams, 4 placed teams → $168 paid, $0 sweep.
  // round 502: season 2, 3-Ball, override on its single placed team.
  const round501 = { played_on: "2026-05-28", format: "2_ball", season_id: 1, is_complete: true };
  const round502 = { played_on: "2026-04-10", format: "3_ball", season_id: 2, is_complete: true };

  const round_payouts = [
    { round_id: 501, team_number: 1, place: 1, per_player: 25, team_size: 2, total_for_team: 50, is_tied: false, was_overridden: false, rounds: round501 },
    { round_id: 501, team_number: 7, place: 2, per_player: 23, team_size: 2, total_for_team: 46, is_tied: false, was_overridden: false, rounds: round501 },
    { round_id: 501, team_number: 4, place: 3, per_player: 20, team_size: 2, total_for_team: 40, is_tied: false, was_overridden: false, rounds: round501 },
    { round_id: 501, team_number: 9, place: 4, per_player: 16, team_size: 2, total_for_team: 32, is_tied: false, was_overridden: false, rounds: round501 },
    { round_id: 502, team_number: 2, place: 1, per_player: 14, team_size: 3, total_for_team: 42, is_tied: false, was_overridden: true, rounds: round502 },
  ];

  // round_players: 24 for round 501 (teams 1..12 ×2), 18 for round 502 (teams 1..6 ×3).
  const round_players: any[] = [];
  let pid = 1;
  for (let team = 1; team <= 12; team++) {
    for (let k = 0; k < 2; k++) {
      round_players.push({ round_id: 501, team_number: team, player_id: pid, players: { full_name: `P${pid} Last${pid}` } });
      pid++;
    }
  }
  for (let team = 1; team <= 6; team++) {
    for (let k = 0; k < 3; k++) {
      round_players.push({ round_id: 502, team_number: team, player_id: pid, players: { full_name: `Q${pid} Last${pid}` } });
      pid++;
    }
  }
  const players = round_players.map((rp) => ({ id: rp.player_id, full_name: rp.players.full_name, is_active: true }));

  dataRef.current = { round_payouts, round_players, players };
}

beforeEach(() => {
  dataRef.current = {};
});

describe("loadWinnings — pure helpers", () => {
  it("resolveBuyIn falls back to 10", () => {
    expect(resolveBuyIn(undefined)).toBe(10);
    expect(resolveBuyIn("")).toBe(10);
    expect(resolveBuyIn("15")).toBe(15);
  });

  it("deriveRoundMoney mirrors the Session-2 formulas", () => {
    expect(deriveRoundMoney(24, 10)).toEqual({ contributed: 240, hio: 24, bfb: 48, balance: 168 });
    expect(deriveRoundMoney(18, 10)).toEqual({ contributed: 180, hio: 18, bfb: 36, balance: 126 });
  });
});

describe("loadFundBalances", () => {
  it("maps the fund_balances view rows to {hio,bfb}", async () => {
    dataRef.current = {
      fund_balances: [
        { fund: "bfb", balance: 184, last_movement: "2026-05-28T00:00:00Z" },
        { fund: "hio", balance: 92, last_movement: "2026-05-21T00:00:00Z" },
      ],
    };
    const b = await loadFundBalances();
    expect(b.bfb).toBe(184);
    expect(b.hio).toBe(92);
  });

  it("returns zeros when the view is empty", async () => {
    dataRef.current = { fund_balances: [] };
    expect(await loadFundBalances()).toMatchObject({ hio: 0, bfb: 0 });
  });
});

describe("loadRecentFundTransactions", () => {
  it("returns newest-first (negative control: seed in wrong order)", async () => {
    dataRef.current = {
      fund_transactions: [
        { fund: "bfb", amount: 36, reason: "buyin_bfb", created_at: "2026-05-14T00:00:00Z" },
        { fund: "bfb", amount: 48, reason: "buyin_bfb", created_at: "2026-05-28T00:00:00Z" }, // newest
        { fund: "hio", amount: 24, reason: "buyin_hio", created_at: "2026-05-21T00:00:00Z" },
      ],
    };
    const txns = await loadRecentFundTransactions(8);
    expect(txns.map((t) => t.created_at)).toEqual([
      "2026-05-28T00:00:00Z",
      "2026-05-21T00:00:00Z",
      "2026-05-14T00:00:00Z",
    ]);
    expect(txns[0].label).toBe("BFB contribution");
  });
});

describe("loadWinningsHistory", () => {
  it("builds rounds with money math, paid, sweep, override flag, rosters", async () => {
    seedHistory();
    const rounds = await loadWinningsHistory(null, 10); // all-time

    expect(rounds.map((r) => r.roundId)).toEqual([501, 502]); // newest first by played_on

    const r501 = rounds.find((r) => r.roundId === 501)!;
    expect(r501.headcount).toBe(24);
    expect(r501.numTeams).toBe(12);
    expect(r501.contributed).toBe(240);
    expect(r501.hio).toBe(24);
    expect(r501.bfb).toBe(48);
    expect(r501.balance).toBe(168);
    expect(r501.paid).toBe(168); // 50+46+40+32
    expect(r501.sweepToBfb).toBe(0);
    expect(r501.hasOverride).toBe(false);
    expect(r501.teams).toHaveLength(4);
    expect(r501.teams[0]).toMatchObject({ place: 1, teamNumber: 1, perPlayer: 25, totalForTeam: 50 });
    expect(r501.teams[0].roster).toContain("P1"); // disambiguated name present
    // Flights S5: redirected_share_count maps through (0 when absent on the row).
    expect(r501.teams[0].redirectedShareCount).toBe(0);

    const r502 = rounds.find((r) => r.roundId === 502)!;
    expect(r502.headcount).toBe(18);
    expect(r502.paid).toBe(42);
    expect(r502.sweepToBfb).toBe(126 - 42);
    expect(r502.hasOverride).toBe(true);
  });

  it("maps redirected_share_count through to the team payout (S5)", async () => {
    seedHistory();
    // Mark Team 1 as having forfeited one share (net total reflects it).
    dataRef.current.round_payouts[0].redirected_share_count = 1;
    dataRef.current.round_payouts[0].total_for_team = 25;
    const rounds = await loadWinningsHistory(null, 10);
    const t1 = rounds.find((r) => r.roundId === 501)!.teams.find((t) => t.teamNumber === 1)!;
    expect(t1.redirectedShareCount).toBe(1);
    expect(t1.totalForTeam).toBe(25);
  });

  it("derives money from the round's OWN buy_in, not the passed fallback (F2.5)", async () => {
    seedHistory();
    // Stamp round 501 with a $15 buy-in; pass a $10 fallback. Money for 501
    // must come from 15 (the snapshot), proving per-round buy_in wins.
    (dataRef.current.round_payouts as any[])
      .filter((r) => r.round_id === 501)
      .forEach((r) => {
        r.rounds = { ...r.rounds, buy_in: 15 };
      });
    const rounds = await loadWinningsHistory(null, 10);
    const r501 = rounds.find((r) => r.roundId === 501)!;
    expect(r501.contributed).toBe(24 * 15); // 360 — from rounds.buy_in, not 10
    expect(r501.balance).toBe(24 * (15 - 1 - 2)); // 288
    // round 502 keeps the fallback (no buy_in on its embedded round).
    const r502 = rounds.find((r) => r.roundId === 502)!;
    expect(r502.contributed).toBe(18 * 10);
  });

  it("season scope filters rounds (negative control: other-season round excluded)", async () => {
    seedHistory();
    const seasonOne = await loadWinningsHistory(1, 10);
    expect(seasonOne.map((r) => r.roundId)).toEqual([501]); // 502 (season 2) excluded
  });

  it("returns [] when there are no payout rows (empty state)", async () => {
    dataRef.current = { round_payouts: [] };
    expect(await loadWinningsHistory(1, 10)).toEqual([]);
  });
});

describe("winningsToCsv", () => {
  it("emits a header + one row per team payout", async () => {
    seedHistory();
    const rounds = await loadWinningsHistory(null, 10);
    const csv = winningsToCsv(rounds);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("date,format,players,teams,place,team_number,roster");
    // 4 team rows (round 501) + 1 (round 502) = 5 data rows + header.
    expect(lines).toHaveLength(6);
    expect(lines[1]).toContain("2026-05-28");
  });
});
