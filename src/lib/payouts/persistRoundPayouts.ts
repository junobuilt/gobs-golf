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
//
// Flights Track, Session 3: the engine runs ONCE PER NON-EMPTY FLIGHT, each
// scoped to that flight's teams / players / buy-ins / format. Per-player fund
// contributions are unchanged (HiO/BFB are per person, so the round-wide sums
// equal the old single run), and EACH flight's BFB sweep is added. Each payout
// row carries its flight_id + flight_name (migration 023). A single-flight round
// resolves to exactly one section, so the persisted payload — payout amounts AND
// funds — is byte-identical to the pre-flights single run (golden-tested).
//
// Flights Track, Session 5: a reconciliation pass over blind-draw fills applies
// Dad's higher-of-two rule — a drawn player keeps the higher of his own-team vs
// drawing-team per-player share; the lower team forfeits one share (recorded in
// round_payouts.redirected_share_count, migration 025) and that amount sweeps to
// BFB under the distinct `blind_draw_redirect` ledger reason. When a drawn
// player's own team didn't place, or the two shares are equal, nothing changes
// (single-flight ordinary draws stay byte-identical).

import { supabase } from "@/lib/supabase";
import { loadRoundResults } from "@/lib/round/results";
import {
  calculatePayouts,
  FLOOR_PER_PLAYER,
  type TeamFinish,
} from "@/lib/payoutEngine";
import { ranksDescending } from "@/lib/leaderboard/rank";

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
  const { flightSections } = loaded.data;

  // Buy-in from league_settings (the app's existing `?? "10"` fallback). HIO and
  // BFB per-player contributions are fixed regardless of buy-in (§2). Read once;
  // every flight's pot uses the same per-player figure.
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

  // One engine run per non-empty flight; accumulate the payout rows + totals.
  type PayoutRow = {
    team_number: number; place: number; per_player: number; team_size: number;
    total_for_team: number; is_tied: boolean; below_floor: boolean;
    flight_id: number; flight_name: string;
    // Flights S5: how many shares this team forfeited to the blind-draw
    // higher-of-two rule (its total_for_team is net of these). 0 normally.
    redirected_share_count: number;
  };
  const payouts: PayoutRow[] = [];
  let totalHeadcount = 0;
  let totalBalance = 0;
  let totalPlacesPaid = 0;
  let totalSweep = 0;
  let maxTeamSize = 0;

  for (const section of flightSections) {
    const teams = section.teams;
    if (teams.length === 0) continue;

    const numTeams = teams.length;
    const headcount = teams.reduce((sum, t) => sum + t.players.length, 0);
    if (headcount === 0) continue;

    // Nominal team size = largest real roster IN THIS FLIGHT; blind draws fill
    // short teams up to this. Engine requires 2|3|4.
    const teamSize = teams.reduce((m, t) => Math.max(m, t.players.length), 0);
    if (teamSize < 2 || teamSize > 4) {
      return { status: "skipped", reason: `unsupported_team_size_${teamSize}` };
    }

    const balance = perPlayerPot * headcount;
    // Par Competition ranks DESCENDING (highest record wins) like Stableford, so
    // it takes the "stableford" basis — the payout engine sorts net_score
    // descending for it. (`net_score` = team.total, already the signed record.)
    const scoringBasis: TeamFinish["scoring_basis"] = ranksDescending(section.format)
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
    for (const tp of result.team_payouts) {
      payouts.push({
        team_number: tp.team_number,
        place: tp.place,
        per_player: tp.per_player,
        team_size: teamSize,
        total_for_team: tp.total_for_team,
        is_tied: tp.is_tied,
        below_floor: tp.per_player < FLOOR_PER_PLAYER,
        flight_id: section.flightId,
        flight_name: section.flightName,
        redirected_share_count: 0,
      });
    }

    totalHeadcount += headcount;
    totalBalance += balance;
    totalPlacesPaid += result.places_paid;
    totalSweep += result.bfb_sweep;
    maxTeamSize = Math.max(maxTeamSize, teamSize);
  }

  if (totalHeadcount === 0) return { status: "skipped", reason: "no_players" };

  // ── Flights S5: blind-draw higher-of-two reconciliation ─────────────────────
  // A blind-draw fill player is associated with TWO per-player shares: one on
  // his OWN team (he's rostered there) and one on the DRAWING team (the fill
  // slot is part of that team's team_size). Dad's rule: he keeps the HIGHER
  // share; the LOWER team forfeits one share, which sweeps to BFB.
  //
  // Reads ONLY loadRoundResults output (no new query): each drawing team's
  // `blindDraws[]` carries the drawn player + `fromTeamNumber` (his own team).
  // per_player values are flight-correct (S3), so cross-flight draws compare
  // each team's own-flight share. No collisions (S4) → a player is in at most
  // these two contexts. Equal shares OR one team unplaced → no change (the
  // single-flight ordinary-draw case stays byte-identical).
  const payoutByTeam = new Map<number, PayoutRow>();
  for (const p of payouts) payoutByTeam.set(p.team_number, p);

  let redirectSweep = 0;
  for (const section of flightSections) {
    for (const team of section.teams) {
      const drawingRow = payoutByTeam.get(team.id);
      for (const fill of team.blindDraws) {
        const ownRow = payoutByTeam.get(fill.fromTeamNumber);
        const pDraw = drawingRow?.per_player ?? 0; // drawing (fill-holding) team
        const pOwn = ownRow?.per_player ?? 0;       // drawn player's own team
        // One side didn't place, or shares are equal → no redirect, no sweep.
        if (pDraw === 0 || pOwn === 0 || pDraw === pOwn) continue;
        // The player keeps the HIGHER share; the LOWER team forfeits one share.
        const loserRow = pDraw < pOwn ? drawingRow! : ownRow!;
        const foregone = Math.min(pDraw, pOwn); // = the loser's per_player
        loserRow.total_for_team = Math.max(0, loserRow.total_for_team - foregone);
        loserRow.redirected_share_count += 1;
        redirectSweep += foregone;
      }
    }
  }

  // Funds are credited at finalize regardless of whether any place was paid (a
  // 1-team flight still collects buy-in; its whole balance sweeps to BFB). HiO +
  // BFB per-player contributions sum across flights → identical to the round-wide
  // headcount. Each flight's sweep is summed into one BFB sweep entry; the
  // blind-draw redirect sweep is a DISTINCT ledger reason.
  const funds: Array<{ fund: string; amount: number; reason: string }> = [
    { fund: "hio", amount: HIO_PER_PLAYER * totalHeadcount, reason: "buyin_hio" },
    { fund: "bfb", amount: BFB_PER_PLAYER * totalHeadcount, reason: "buyin_bfb" },
  ];
  if (totalSweep > 0) {
    funds.push({ fund: "bfb", amount: totalSweep, reason: "sweep" });
  }
  if (redirectSweep > 0) {
    funds.push({ fund: "bfb", amount: redirectSweep, reason: "blind_draw_redirect" });
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
    placesPaid: totalPlacesPaid,
    headcount: totalHeadcount,
    balance: totalBalance,
    teamSize: maxTeamSize,
  };
}
