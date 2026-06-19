// F2.1 / F2.2 — per-player money read layer for the admin Money "By Player"
// screen. READ-ONLY, NO recompute.
//
// This is a PROJECTION of the same canonical persisted data the "By Round"
// screen reads: round_payouts.per_player (what each player on a paid team won)
// and rounds.buy_in (what each rostered player paid in). It never re-runs the
// payout engine — the cross-surface agreement test asserts a player's drill
// `won` equals the By Round per-team `perPlayer` equals the underlying
// round_payouts.per_player row.

import { supabase } from "@/lib/supabase";
import { getDisplayName, type PlayerLike } from "@/lib/players/displayName";
import type { Format } from "@/lib/scoring/types";

export type PlayerRoundWinnings = {
  roundId: number;
  playedOn: string;
  format: Format;
  won: number; // round_payouts.per_player for this player's team; 0 if it didn't place
  buyIn: number; // rounds.buy_in (snapshot, migration 030)
  net: number; // won − buyIn
};

export type PlayerWinnings = {
  playerId: number;
  name: string;
  roundsPlayed: number; // qualifying rounds the player actually played
  net: number; // Σ net across rounds
  avg: number; // net ÷ roundsPlayed (sat-out weeks never dilute)
  rounds: PlayerRoundWinnings[]; // newest first
};

function embedRound(row: any): any {
  return Array.isArray(row.rounds) ? row.rounds[0] : row.rounds;
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Keep each round_players `.in()` filter well under Supabase's 1000-row default
// response cap. ~14-24 players/round → 25 rounds/chunk ≈ ≤600 rows. Season scope
// (~30 rounds) is one chunk; all-time fans out across a few chunks rather than a
// single unbounded `.in()` that would silently truncate (CLAUDE.md principle #6).
const RP_CHUNK = 25;

/**
 * Per-player season (or all-time) winnings, ranked by net descending.
 * `seasonId` scopes to one season; pass null for all-time. A round "counts"
 * exactly when it has persisted round_payouts (same universe as By Round).
 */
export async function loadPlayerWinnings(
  seasonId: number | null,
): Promise<PlayerWinnings[]> {
  // 1. Canonical payouts joined to their round — the SAME source as By Round.
  let q = supabase
    .from("round_payouts")
    .select(
      "round_id, team_number, per_player, " +
        "rounds!inner ( played_on, format, season_id, is_complete, buy_in )",
    )
    .eq("rounds.is_complete", true);
  if (seasonId != null) {
    q = q.eq("rounds.season_id", seasonId);
  }
  const { data: payoutRows } = await q;
  if (!payoutRows || payoutRows.length === 0) return [];

  // Per-round metadata + a (round, team) → per_player lookup.
  const roundMeta: Record<
    number,
    { playedOn: string; format: Format; buyIn: number }
  > = {};
  const perPlayerByRoundTeam: Record<number, Record<number, number>> = {};
  for (const r of payoutRows as any[]) {
    const rid = r.round_id as number;
    const round = embedRound(r);
    if (!roundMeta[rid]) {
      roundMeta[rid] = {
        playedOn: round?.played_on as string,
        format: round?.format as Format,
        buyIn: round?.buy_in != null ? Number(round.buy_in) : 0,
      };
    }
    (perPlayerByRoundTeam[rid] ??= {})[r.team_number as number] =
      r.per_player as number;
  }
  const roundIds = Object.keys(roundMeta).map(Number);

  // 2. Rosters for those rounds (team_number > 0). Chunked so all-time can't
  //    blow past the 1000-row cap.
  const rpChunks = await Promise.all(
    chunk(roundIds, RP_CHUNK).map((ids) =>
      supabase
        .from("round_players")
        .select("round_id, team_number, player_id, players ( full_name )")
        .in("round_id", ids)
        .gt("team_number", 0)
        .then(({ data }) => data ?? []),
    ),
  );
  const rps = rpChunks.flat();

  // 3. Active roster for display-name disambiguation (matches loadWinnings).
  const { data: activePlayerRows } = await supabase
    .from("players")
    .select("id, full_name, is_active")
    .eq("is_active", true);
  const activeRoster: PlayerLike[] = (activePlayerRows ?? []) as PlayerLike[];
  const nameFor = (id: number, full: string | null | undefined): string =>
    full ? getDisplayName({ id, full_name: full }, activeRoster) : "?";

  // 4. Aggregate per player.
  //
  // G1 (deferred — Phase G "Buy-in records per round per player"): EVERY
  // rostered player is assumed to have bought in at the round's amount. The
  // future G1 column on round_players (a per-player buy-in / "didn't buy in"
  // flag for guests + late arrivals) will be read here instead of the flat
  // round buy-in. Until then, net = won − rounds.buy_in for everyone on a team.
  const byPlayer = new Map<number, PlayerWinnings>();
  for (const rp of rps as any[]) {
    const rid = rp.round_id as number;
    const meta = roundMeta[rid];
    if (!meta) continue;
    const playerRow = Array.isArray(rp.players) ? rp.players[0] : rp.players;
    const pid = rp.player_id as number;
    const won = perPlayerByRoundTeam[rid]?.[rp.team_number as number] ?? 0;
    const net = won - meta.buyIn;

    let agg = byPlayer.get(pid);
    if (!agg) {
      agg = {
        playerId: pid,
        name: nameFor(pid, playerRow?.full_name),
        roundsPlayed: 0,
        net: 0,
        avg: 0,
        rounds: [],
      };
      byPlayer.set(pid, agg);
    }
    agg.roundsPlayed += 1;
    agg.net += net;
    agg.rounds.push({
      roundId: rid,
      playedOn: meta.playedOn,
      format: meta.format,
      won,
      buyIn: meta.buyIn,
      net,
    });
  }

  const out = [...byPlayer.values()];
  for (const p of out) {
    p.avg = p.roundsPlayed > 0 ? p.net / p.roundsPlayed : 0;
    // Drill list newest-first.
    p.rounds.sort((a, b) =>
      a.playedOn < b.playedOn ? 1 : a.playedOn > b.playedOn ? -1 : 0,
    );
  }
  // Default sort: net descending, name ascending as a stable tiebreak.
  out.sort(
    (a, b) => b.net - a.net || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  return out;
}
