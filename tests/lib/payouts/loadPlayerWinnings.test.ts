import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit tests for the By Player money loader. A small in-memory supabase mock
// (same shape as loadWinnings.test.ts) honours the chains the lib uses: dotted
// embed `eq` filters, `in`, `gt`, and a thenable terminal. Negative controls:
// players seeded in non-ranked order (the sort must do work), an other-season
// round excluded under season scope, and an unplaced team (won = 0).

const dataRef = vi.hoisted(() => ({ current: {} as Record<string, any[]> }));

vi.mock("@/lib/supabase", () => {
  function get(row: any, path: string) {
    return path.split(".").reduce((o, k) => (o == null ? o : o[k]), row);
  }
  class Builder {
    private eqs: Array<[string, any]> = [];
    private ins: [string, any[]] | null = null;
    private gts: Array<[string, any]> = [];
    constructor(private table: string) {}
    select() { return this; }
    eq(col: string, val: any) { this.eqs.push([col, val]); return this; }
    in(col: string, vals: any[]) { this.ins = [col, vals]; return this; }
    gt(col: string, val: any) { this.gts.push([col, val]); return this; }
    private run() {
      let rows = [...(dataRef.current[this.table] ?? [])];
      for (const [c, v] of this.eqs) rows = rows.filter((r) => get(r, c) === v);
      if (this.ins) rows = rows.filter((r) => this.ins![1].includes(get(r, this.ins![0])));
      for (const [c, v] of this.gts) rows = rows.filter((r) => get(r, c) > v);
      return { data: rows, error: null };
    }
    then<T>(onF: (v: { data: any; error: any }) => T) { return Promise.resolve(this.run()).then(onF); }
  }
  return { supabase: { from: (t: string) => new Builder(t) } };
});

import { loadPlayerWinnings } from "@/lib/payouts/loadPlayerWinnings";

// Three rounds: 601 + 602 in season 1, 701 in season 2. All $10 buy-in.
const r601 = { played_on: "2026-05-01", format: "2_ball", season_id: 1, is_complete: true, buy_in: 10 };
const r602 = { played_on: "2026-05-08", format: "best_ball", season_id: 1, is_complete: true, buy_in: 10 };
const r701 = { played_on: "2026-04-01", format: "2_ball", season_id: 2, is_complete: true, buy_in: 10 };

function seed() {
  const round_payouts = [
    // 601: team1 ($25/pl), team2 ($20/pl). team3 did NOT place (no row).
    { round_id: 601, team_number: 1, per_player: 25, rounds: r601 },
    { round_id: 601, team_number: 2, per_player: 20, rounds: r601 },
    // 602: only team1 placed ($18/pl). Player A is on the unplaced team3.
    { round_id: 602, team_number: 1, per_player: 18, rounds: r602 },
    // 701 (season 2): team1 ($30/pl).
    { round_id: 701, team_number: 1, per_player: 30, rounds: r701 },
  ];
  const round_players = [
    { round_id: 601, team_number: 1, player_id: 1, players: { full_name: "Alpha A" } },
    { round_id: 601, team_number: 1, player_id: 11, players: { full_name: "Xray X" } },
    { round_id: 601, team_number: 2, player_id: 2, players: { full_name: "Bravo B" } },
    { round_id: 601, team_number: 2, player_id: 12, players: { full_name: "Yankee Y" } },
    { round_id: 602, team_number: 1, player_id: 3, players: { full_name: "Charlie C" } },
    { round_id: 602, team_number: 1, player_id: 13, players: { full_name: "Delta D" } },
    { round_id: 602, team_number: 3, player_id: 1, players: { full_name: "Alpha A" } },
    { round_id: 602, team_number: 3, player_id: 4, players: { full_name: "Echo E" } },
    { round_id: 701, team_number: 1, player_id: 1, players: { full_name: "Alpha A" } },
    { round_id: 701, team_number: 1, player_id: 14, players: { full_name: "Zulu Z" } },
  ];
  const players = round_players.map((rp) => ({ id: rp.player_id, full_name: rp.players.full_name, is_active: true }));
  dataRef.current = { round_payouts, round_players, players };
}

beforeEach(() => {
  dataRef.current = {};
});

describe("loadPlayerWinnings", () => {
  it("computes season-scoped net, buy-in subtraction, unplaced=0, and avg over rounds played", async () => {
    seed();
    const s1 = await loadPlayerWinnings(1); // season 1 only

    const a = s1.find((p) => p.playerId === 1)!;
    // 601 team1 won $25 (net +15); 602 team3 unplaced won $0 (net −10).
    expect(a.roundsPlayed).toBe(2);
    expect(a.net).toBe(5);
    expect(a.avg).toBeCloseTo(2.5, 5); // 5 / 2 rounds actually played
    // Drill is newest-first and carries per-round won/net.
    expect(a.rounds.map((r) => r.roundId)).toEqual([602, 601]);
    expect(a.rounds.find((r) => r.roundId === 601)).toMatchObject({ won: 25, buyIn: 10, net: 15 });
    expect(a.rounds.find((r) => r.roundId === 602)).toMatchObject({ won: 0, buyIn: 10, net: -10 });

    // Season 2's round 701 is excluded from the season-1 scope.
    expect(a.rounds.some((r) => r.roundId === 701)).toBe(false);
  });

  it("ranks by net descending (negative control: highest-net player not seeded first)", async () => {
    seed();
    const s1 = await loadPlayerWinnings(1);
    // Xray (id 11) won $25 net +15 — the top. Echo (id 4) net −10 — the bottom.
    expect(s1[0].playerId).toBe(11);
    expect(s1[0].net).toBe(15);
    expect(s1[s1.length - 1].playerId).toBe(4);
    expect(s1[s1.length - 1].net).toBe(-10);
    // Net is monotonically non-increasing across the ranked list.
    const nets = s1.map((p) => p.net);
    expect([...nets].sort((x, y) => y - x)).toEqual(nets);
  });

  it("all-time scope sums across seasons for a player who appears in both", async () => {
    seed();
    const all = await loadPlayerWinnings(null);
    const a = all.find((p) => p.playerId === 1)!;
    // season1 net +5 + season2 (701 team1 $30, net +20) = +25 over 3 rounds.
    expect(a.roundsPlayed).toBe(3);
    expect(a.net).toBe(25);
  });

  it("returns [] when no finalized rounds have payouts", async () => {
    dataRef.current = { round_payouts: [] };
    expect(await loadPlayerWinnings(1)).toEqual([]);
  });
});
