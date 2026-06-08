// Phase G2 (Session 2) — payout + fund persistence orchestration.
//
// Runs AFTER a round is finalized (blind draws resolved, is_complete=true).
// Derives the engine inputs from post-blind-draw standings, runs the frozen
// payout engine in tie-resolution mode, and persists the result atomically via
// the persist_round_payouts RPC (migration 016).
//
// Pure-ish: no React. Callers (scorecard finalize effect, EditModeBanner admin
// re-finalize) invoke this after finalize succeeds. A persist failure is
// non-fatal to finalize — the round is already complete; re-running this heals
// it (the RPC is idempotent). A finalized round with zero round_payouts rows is
// the detectable "payout pending" signal for Session 4.
//
// Derivation (validated against prod, see STATUS 2026-06-07):
//   team_size = max team roster (nominal size blind draws fill toward)
//   num_teams = number of teams
//   players (engine) = num_teams * team_size  → so short (blind-drawn) teams
//     still count when the engine derives floor(players/team_size). Passing the
//     real headcount under-counts teams and would pay too few places.
//   headcount = real paying people (sum of team rosters) → drives balance+funds
//   balance   = (buy_in - HIO - BFB) * headcount   (buy_in default 10)
//   team_finishes: net_score = team.total (results.ts already signs it so the
//     engine's best_n-ascending / stableford-descending sort picks the winner)

import { supabase } from "@/lib/supabase";
import { loadRoundResults } from "@/lib/round/results";
import {
  calculatePayouts,
  FLOOR_PER_PLAYER,
  type TeamFinish,
} from "@/lib/payoutEngine";
import { isStablefordFormat } from "@/lib/leaderboard/rank";

const DEFAULT_BUY_IN = 10;
const HIO_PER_PLAYER = 1; // §2 fixed contribution
const BFB_PER_PLAYER = 2; // §2 fixed contribution

export type PersistPayoutsOutcome =
  | {
      status: "persisted";
      placesPaid: number;
      headcount: number;
      balance: number;
      teamSize: number;
    }
  | { status: "skipped"; reason: string };

export async function computeAndPersistRoundPayouts(
  roundId: number,
): Promise<PersistPayoutsOutcome> {
  const loaded = await loadRoundResults(roundId);
  if (loaded.status !== "ok") {
    return { status: "skipped", reason: loaded.status };
  }
  const { teams, format } = loaded.data;

  const numTeams = teams.length;
  const headcount = teams.reduce((sum, t) => sum + t.players.length, 0);
  if (headcount === 0) return { status: "skipped", reason: "no_players" };

  // Nominal team size = largest real roster; blind draws fill short teams up to
  // this. Engine requires 2|3|4.
  const teamSize = teams.reduce((m, t) => Math.max(m, t.players.length), 0);
  if (teamSize < 2 || teamSize > 4) {
    return { status: "skipped", reason: `unsupported_team_size_${teamSize}` };
  }

  // Buy-in from league_settings (the app's existing `?? "10"` fallback). HIO and
  // BFB per-player contributions are fixed regardless of buy-in (§2).
  const { data: setting } = await supabase
    .from("league_settings")
    .select("value")
    .eq("key", "buy_in_amount")
    .maybeSingle();
  const buyIn =
    setting?.value != null && setting.value !== ""
      ? Number(setting.value)
      : DEFAULT_BUY_IN;
  const perPlayerPot = Math.max(
    0,
    Math.round(buyIn) - HIO_PER_PLAYER - BFB_PER_PLAYER,
  );
  const balance = perPlayerPot * headcount;

  const scoringBasis: TeamFinish["scoring_basis"] = isStablefordFormat(format)
    ? "stableford"
    : "best_n";
  const team_finishes: TeamFinish[] = teams.map((t) => ({
    team_number: t.id,
    net_score: t.total,
    scoring_basis: scoringBasis,
  }));

  const result = calculatePayouts({
    players: numTeams * teamSize,
    team_size: teamSize as 2 | 3 | 4,
    balance,
    team_finishes,
  });

  // below_floor is not surfaced on the frozen engine's TeamPayout; derive it
  // faithfully from the engine's FLOOR constant (per_player below floor).
  const payouts = result.team_payouts.map((tp) => ({
    team_number: tp.team_number,
    place: tp.place,
    per_player: tp.per_player,
    team_size: teamSize,
    total_for_team: tp.total_for_team,
    is_tied: tp.is_tied,
    below_floor: tp.per_player < FLOOR_PER_PLAYER,
  }));

  // Funds are credited at finalize regardless of whether any place was paid
  // (a 1-team round still collects buy-in; the whole balance sweeps to BFB).
  const funds: Array<{ fund: string; amount: number; reason: string }> = [
    { fund: "hio", amount: HIO_PER_PLAYER * headcount, reason: "buyin_hio" },
    { fund: "bfb", amount: BFB_PER_PLAYER * headcount, reason: "buyin_bfb" },
  ];
  if (result.bfb_sweep > 0) {
    funds.push({ fund: "bfb", amount: result.bfb_sweep, reason: "sweep" });
  }

  const { error } = await supabase.rpc("persist_round_payouts", {
    p_round_id: roundId,
    p_payload: { payouts, funds },
  });
  if (error) {
    throw new Error("persist_round_payouts: " + error.message);
  }

  return {
    status: "persisted",
    placesPaid: result.places_paid,
    headcount,
    balance,
    teamSize,
  };
}
