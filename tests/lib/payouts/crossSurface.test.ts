import { describe, it, expect, vi, beforeEach } from "vitest";

// CROSS-SURFACE AGREEMENT (CLAUDE.md principle #7). The same per-team dollar
// figure surfaces in three places that must agree to the dollar:
//   1. By Round  — loadWinningsHistory(...).teams[T].perPlayer
//   2. By Player — loadPlayerWinnings(...) drill entry `.won` for a player on T
//   3. The persisted source — round_payouts[T].per_player
// Both loaders are PROJECTIONS of round_payouts; this asserts numerical
// equality (not "each renders"). One round, 3 teams, 6 players.

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
    order() { return this; }
    limit() { return this; }
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

import { loadWinningsHistory } from "@/lib/payouts/loadWinnings";
import { loadPlayerWinnings } from "@/lib/payouts/loadPlayerWinnings";

const round = { played_on: "2026-06-16", format: "2_ball", season_id: 1, is_complete: true, buy_in: 10 };
const RID = 801;

// Known per-team payouts: T1 $25×2, T2 $23×2, T3 $20×2. One player per team is
// tracked for the By Player assertion (the team's "anchor" player).
const TEAMS = [
  { team: 1, perPlayer: 25, players: [1, 2] },
  { team: 2, perPlayer: 23, players: [3, 4] },
  { team: 3, perPlayer: 20, players: [5, 6] },
];

beforeEach(() => {
  const round_payouts = TEAMS.map((t, i) => ({
    round_id: RID,
    team_number: t.team,
    place: i + 1,
    per_player: t.perPlayer,
    team_size: 2,
    total_for_team: t.perPlayer * 2,
    is_tied: false,
    was_overridden: false,
    redirected_share_count: 0,
    rounds: round,
  }));
  const round_players = TEAMS.flatMap((t) =>
    t.players.map((pid) => ({
      round_id: RID,
      team_number: t.team,
      player_id: pid,
      players: { full_name: `Player ${pid}` },
    })),
  );
  const players = round_players.map((rp) => ({ id: rp.player_id, full_name: rp.players.full_name, is_active: true }));
  dataRef.current = { round_payouts, round_players, players };
});

describe("cross-surface money agreement", () => {
  it("By Round perPlayer == By Player drill won == round_payouts.per_player, per team", async () => {
    const byRound = await loadWinningsHistory(1, 10);
    const byPlayer = await loadPlayerWinnings(1);

    const roundRow = byRound.find((r) => r.roundId === RID)!;
    expect(roundRow).toBeTruthy();

    for (const t of TEAMS) {
      // (1) By Round — the per-team row.
      const brTeam = roundRow.teams.find((x) => x.teamNumber === t.team)!;
      // (3) the persisted source row.
      const persisted = dataRef.current.round_payouts.find(
        (r: any) => r.team_number === t.team,
      ).per_player;

      // For every player on this team, By Player must show the SAME won.
      for (const pid of t.players) {
        const player = byPlayer.find((p) => p.playerId === pid)!;
        const entry = player.rounds.find((r) => r.roundId === RID)!;
        // (2) == (1) == (3): single numeric equality chain.
        expect(entry.won).toBe(brTeam.perPlayer);
        expect(entry.won).toBe(persisted);
        // And net reconciles to won − the round's buy-in.
        expect(entry.net).toBe(brTeam.perPlayer - round.buy_in);
      }
    }
  });
});
