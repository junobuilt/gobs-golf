// Phase G2 (Session 4a) — read-only data layer for the admin Winnings tab.
//
// NO writes, NO RPCs. Reads the migration-016 objects (round_payouts,
// fund_transactions, fund_balances view) plus rounds/round_players/players.
//
// Money derivations MIRROR src/lib/payouts/persistRoundPayouts.ts (frozen this
// session, so its constants can't be imported without modifying it). These MUST
// stay in sync with that file — it is the source of truth for what finalize
// actually persisted.

import { supabase } from "@/lib/supabase";
import { getDisplayName, type PlayerLike } from "@/lib/players/displayName";
import type { Format } from "@/lib/scoring/types";
import { deriveRoundMoney } from "@/lib/payouts/winningsMoney";

// Pure money helpers live in winningsMoney.ts (no supabase) so the calculator
// can use them without dragging in the DB client. Re-exported here for callers
// that already import from this module + the lib tests.
export {
  DEFAULT_BUY_IN,
  HIO_PER_PLAYER,
  BFB_PER_PLAYER,
  resolveBuyIn,
  deriveRoundMoney,
  type RoundMoney,
} from "@/lib/payouts/winningsMoney";

// --- fund balances ---------------------------------------------------------
export type FundBalances = {
  hio: number;
  bfb: number;
  hioLastMovement: string | null;
  bfbLastMovement: string | null;
};

export async function loadFundBalances(): Promise<FundBalances> {
  const { data } = await supabase
    .from("fund_balances")
    .select("fund, balance, last_movement");
  const out: FundBalances = {
    hio: 0,
    bfb: 0,
    hioLastMovement: null,
    bfbLastMovement: null,
  };
  (data ?? []).forEach((row: any) => {
    if (row.fund === "hio") {
      out.hio = row.balance ?? 0;
      out.hioLastMovement = row.last_movement ?? null;
    } else if (row.fund === "bfb") {
      out.bfb = row.balance ?? 0;
      out.bfbLastMovement = row.last_movement ?? null;
    }
  });
  return out;
}

// --- recent fund transactions ---------------------------------------------
export type FundTxn = {
  fund: "hio" | "bfb";
  amount: number;
  reason: string;
  created_at: string;
  label: string;
};

const REASON_LABELS: Record<string, string> = {
  buyin_hio: "HiO contribution",
  buyin_bfb: "BFB contribution",
  sweep: "BFB sweep",
  reopen_reversal: "Reversal (round reopened)",
  reset: "Fund reset",
  // Flights S5: a blind-draw player kept the higher of his two per-player
  // shares; the lower team's foregone share swept here.
  blind_draw_redirect: "Blind-draw redirect",
};

export function reasonLabel(fund: string, reason: string): string {
  return REASON_LABELS[reason] ?? `${fund.toUpperCase()} ${reason}`;
}

export async function loadRecentFundTransactions(
  limit = 8,
): Promise<FundTxn[]> {
  const { data } = await supabase
    .from("fund_transactions")
    .select("fund, amount, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((row: any) => ({
    fund: row.fund,
    amount: row.amount,
    reason: row.reason,
    created_at: row.created_at,
    label: reasonLabel(row.fund, row.reason),
  }));
}

// --- historical payouts ----------------------------------------------------
export type WinningsTeamPayout = {
  teamNumber: number;
  place: number;
  perPlayer: number;
  teamSize: number;
  totalForTeam: number;
  isTied: boolean;
  roster: string; // display names joined with " · "
  // Flights S3: flight this payout was computed under (snapshot, migration 023).
  // NULL on historical/single-flight rows → the panel renders ungrouped.
  flightId: number | null;
  flightName: string | null;
  // Flights S5: shares this team forfeited to the blind-draw higher-of-two rule
  // (migration 025). totalForTeam is already net of these; >0 → render the
  // "−N share → BFB" marker. 0 on every historical/non-redirect row.
  redirectedShareCount: number;
  // S4b override surface: per-team override state (drives Edit/Revert + "was $X").
  wasOverridden: boolean;
  originalAmount: number | null; // engine value before override; null when not overridden
  overrideReason: string | null; // latest admin override/revert reason
};

export type WinningsRound = {
  roundId: number;
  playedOn: string;
  format: Format;
  numTeams: number;
  headcount: number;
  teamSize: number | null;
  hasOverride: boolean;
  paid: number;
  sweepToBfb: number;
  contributed: number;
  hio: number;
  bfb: number;
  balance: number;
  teams: WinningsTeamPayout[];
};

function embedRound(payoutRow: any): any {
  // PostgREST embed may be an object or single-element array.
  return Array.isArray(payoutRow.rounds) ? payoutRow.rounds[0] : payoutRow.rounds;
}

/**
 * One entry per finalized round that has round_payouts rows, newest first.
 * `seasonId` scopes to one season; pass null for all-time. `buyIn` drives the
 * per-round money stats (mirrors S2's derivation).
 */
export async function loadWinningsHistory(
  seasonId: number | null,
  buyIn: number,
): Promise<WinningsRound[]> {
  let q = supabase
    .from("round_payouts")
    .select(
      "round_id, team_number, place, per_player, team_size, total_for_team, " +
        "is_tied, flight_id, flight_name, redirected_share_count, " +
        "was_overridden, original_amount, override_reason, " +
        "rounds!inner ( played_on, format, season_id, is_complete )",
    )
    .eq("rounds.is_complete", true);
  if (seasonId != null) {
    q = q.eq("rounds.season_id", seasonId);
  }
  const { data: payoutRows } = await q;
  if (!payoutRows || payoutRows.length === 0) return [];

  const roundIds = [...new Set(payoutRows.map((r: any) => r.round_id as number))];

  // Rosters + headcount per round, and the active-player universe for names.
  const [{ data: rps }, { data: activePlayerRows }] = await Promise.all([
    supabase
      .from("round_players")
      .select("round_id, team_number, player_id, players ( full_name )")
      .in("round_id", roundIds)
      .gt("team_number", 0),
    supabase.from("players").select("id, full_name, is_active").eq("is_active", true),
  ]);

  const activeRoster: PlayerLike[] = (activePlayerRows ?? []) as PlayerLike[];
  const nameFor = (playerId: number, fullName: string | null | undefined): string =>
    fullName ? getDisplayName({ id: playerId, full_name: fullName }, activeRoster) : "?";

  // round_id -> { headcount, teamNumbers set, rosterByTeam }
  const rosterByRoundTeam: Record<number, Record<number, string[]>> = {};
  const headcountByRound: Record<number, number> = {};
  const teamSetByRound: Record<number, Set<number>> = {};
  (rps ?? []).forEach((rp: any) => {
    const rid = rp.round_id as number;
    const tn = rp.team_number as number;
    const playerRow = Array.isArray(rp.players) ? rp.players[0] : rp.players;
    (rosterByRoundTeam[rid] ??= {});
    (rosterByRoundTeam[rid][tn] ??= []).push(nameFor(rp.player_id, playerRow?.full_name));
    headcountByRound[rid] = (headcountByRound[rid] ?? 0) + 1;
    (teamSetByRound[rid] ??= new Set()).add(tn);
  });

  // Group payout rows by round.
  const byRound: Record<number, any[]> = {};
  payoutRows.forEach((r: any) => {
    (byRound[r.round_id] ??= []).push(r);
  });

  const rounds: WinningsRound[] = roundIds.map((rid) => {
    const rows = byRound[rid];
    const round = embedRound(rows[0]);
    const headcount = headcountByRound[rid] ?? 0;
    const numTeams = teamSetByRound[rid]?.size ?? 0;
    const money = deriveRoundMoney(headcount, buyIn);
    const paid = rows.reduce((s, r) => s + (r.total_for_team as number), 0);
    const teamSize = rows.length > 0 ? (rows[0].team_size as number) : null;
    const hasOverride = rows.some((r) => r.was_overridden === true);

    const teams: WinningsTeamPayout[] = rows
      .map((r) => ({
        teamNumber: r.team_number as number,
        place: r.place as number,
        perPlayer: r.per_player as number,
        teamSize: r.team_size as number,
        totalForTeam: r.total_for_team as number,
        isTied: r.is_tied === true,
        roster: (rosterByRoundTeam[rid]?.[r.team_number as number] ?? []).join(" · "),
        flightId: (r.flight_id ?? null) as number | null,
        flightName: (r.flight_name ?? null) as string | null,
        redirectedShareCount: (r.redirected_share_count ?? 0) as number,
        wasOverridden: r.was_overridden === true,
        originalAmount: (r.original_amount ?? null) as number | null,
        overrideReason: (r.override_reason ?? null) as string | null,
      }))
      .sort((a, b) => a.place - b.place || a.teamNumber - b.teamNumber);

    return {
      roundId: rid,
      playedOn: round?.played_on as string,
      format: round?.format as Format,
      numTeams,
      headcount,
      teamSize,
      hasOverride,
      paid,
      sweepToBfb: money.balance - paid,
      contributed: money.contributed,
      hio: money.hio,
      bfb: money.bfb,
      balance: money.balance,
      teams,
    };
  });

  // Newest first.
  rounds.sort((a, b) => (a.playedOn < b.playedOn ? 1 : a.playedOn > b.playedOn ? -1 : 0));
  return rounds;
}

// --- CSV export ------------------------------------------------------------
const CSV_COLUMNS = [
  "date", "format", "players", "teams", "place", "team_number", "roster",
  "per_player", "team_size", "total_for_team", "is_tied", "was_overridden",
  "round_paid", "round_sweep_to_bfb", "contributed", "hio", "bfb_contribution",
  "balance",
] as const;

function csvCell(v: string | number | boolean): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per team-payout; round-level fields repeated. */
export function winningsToCsv(rounds: WinningsRound[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rounds) {
    for (const t of r.teams) {
      lines.push(
        [
          r.playedOn, r.format, r.headcount, r.numTeams, t.place, t.teamNumber,
          t.roster, t.perPlayer, t.teamSize, t.totalForTeam, t.isTied,
          r.hasOverride, r.paid, r.sweepToBfb, r.contributed, r.hio, r.bfb,
          r.balance,
        ].map(csvCell).join(","),
      );
    }
  }
  return lines.join("\n");
}
