// Golden-master fixtures — turn a frozen prod round bundle into a deterministic
// FakeData seed for loadRoundResults, plus the snapshot projection and the
// independent payout-anchor check.

import type { FakeData } from "../../components/fake-supabase";
import type { LoadedRoundResults } from "@/lib/round/results";
import { GOLDEN_ROSTER } from "./roster";

// One round's frozen prod export. `scores` are compact [rpId, hole, strokes]
// triples to keep the fixtures readable.
export type GoldenBundle = {
  round: {
    id: number;
    played_on: string;
    is_complete: boolean;
    format: string;
    format_config: Record<string, unknown>;
    format_locked_at: string | null;
  };
  round_players: Array<{
    id: number; player_id: number; team_number: number; tee_id: number;
    course_handicap: number | null; dropped_after_hole: number | null;
  }>;
  tees: Array<{ id: number; color: string; slope_rating: number; course_rating: number; par: number; sort_order: number }>;
  holes: Array<{ tee_id: number; hole_number: number; par: number; stroke_index: number }>;
  scores: Array<[number, number, number]>; // [round_player_id, hole_number, strokes]
  blind_draws: Array<{ short_team_number: number; drawn_player_id: number; hole_range_start: number; hole_range_end: number }>;
  team_scores?: Array<{ team_number: number; hole_number: number; ball_index: number; strokes: number }>;
  // The round's LOCKED round_payouts (team → place), when they exist. The
  // independent NET-ranking anchor — NOT computed by loadRoundResults. Empty for
  // rounds finalized before payouts auto-persisted (S3 backfill was skipped):
  // only round 171 has them in prod. Those rounds rely on the gross-from-scores
  // anchor (assertGrossTotalsFromScores) + structural invariants instead.
  payouts: Array<{ team_number: number; place: number; per_player: number }>;
};

// Build the in-memory FakeData seed loadRoundResults reads from.
export function buildFakeData(bundle: GoldenBundle): FakeData {
  return {
    rounds: [{
      ...bundle.round,
      course_id: 1,
      created_at: `${bundle.round.played_on}T00:00:00Z`,
    }],
    tees: bundle.tees.map(t => ({ ...t })),
    holes: bundle.holes.map((h, i) => ({ id: 100000 + i, ...h, yardage: 350 })),
    round_players: bundle.round_players.map(rp => ({ ...rp, round_id: bundle.round.id })),
    players: GOLDEN_ROSTER.map(p => ({ ...p })),
    scores: bundle.scores.map(([rpId, hole, strokes], i) => ({
      id: 200000 + i, round_player_id: rpId, hole_number: hole, strokes,
    })),
    blind_draws: bundle.blind_draws.map((bd, i) => ({ id: 300000 + i, round_id: bundle.round.id, ...bd })),
    team_scores: (bundle.team_scores ?? []).map(ts => ({ round_id: bundle.round.id, ...ts })),
  };
}

// The frozen snapshot shape: every team (rank/total/roster/F9/B9) + every player
// (gross/net). Deliberately omits the 18-length per-hole arrays — gross/net +
// the leg totals already capture scoring correctness and keep the snapshot
// human-readable.
export function projectResults(data: LoadedRoundResults) {
  return {
    format: data.format,
    maxThru: data.maxThru,
    teams: [...data.teams]
      .sort((a, b) => a.rank - b.rank)
      .map(t => ({
        teamNumber: t.id,
        rank: t.rank,
        total: t.total,
        totalLabel: t.totalLabel,
        placeLabel: t.placeLabel,
        roster: t.rosterDisplay,
        f9: t.f9Total,
        b9: t.b9Total,
        players: t.players.map(p => ({
          name: p.displayName,
          gross: p.grossTotal,
          net: p.netTotal,
          netValue: p.netValue,
          holesPlayed: p.holesPlayed,
        })),
        blindDraws: t.blindDraws.map(bd => ({
          drawn: bd.drawnPlayerName,
          fromTeam: bd.fromTeamNumber,
          range: [bd.holeRangeStart, bd.holeRangeEnd],
          netValue: bd.drawnPlayerNetValue,
        })),
      })),
  };
}

// INDEPENDENT ANCHOR available for EVERY round (no payouts needed): a player's
// gross total is pure summation of their raw scores — no scoring engine. So
// `player.grossTotal` must equal the sum of that round_player's fixture score
// rows. This is exactly the check the History list lacked: TD33 truncated the
// batched scores fetch, so gross totals came out wrong/zero. Throws on mismatch.
export function assertGrossTotalsFromScores(
  data: LoadedRoundResults,
  bundle: GoldenBundle,
): void {
  const expected = new Map<number, number>();
  for (const [rpId, , strokes] of bundle.scores) {
    expected.set(rpId, (expected.get(rpId) ?? 0) + strokes);
  }
  for (const team of data.teams) {
    for (const p of team.players) {
      if (p.holesPlayed === 0) continue; // team-card roster rows carry no scores
      const exp = expected.get(p.rpId);
      if (exp == null) throw new Error(`no fixture scores for round_player ${p.rpId}`);
      if (p.grossTotal !== exp) {
        throw new Error(`gross mismatch rp ${p.rpId} (${p.displayName}): engine ${p.grossTotal} vs fixture-sum ${exp}`);
      }
    }
  }
}

// INDEPENDENT ANCHOR: the ranking loadRoundResults produces must be consistent
// with the round's locked round_payouts. For any two PAID teams: a lower place
// ⇒ a strictly lower rank, and an equal place ⇒ an equal rank (ties). This
// proves we froze the KNOWN-CORRECT ranking, not whatever the code happened to
// emit. Throws (with detail) on any inconsistency.
export function assertRankingMatchesPayouts(
  data: LoadedRoundResults,
  payouts: GoldenBundle["payouts"],
): void {
  const rankOf = new Map(data.teams.map(t => [t.id, t.rank]));
  for (const a of payouts) {
    const ra = rankOf.get(a.team_number);
    if (ra == null) throw new Error(`paid team ${a.team_number} not found in results`);
    for (const b of payouts) {
      const rb = rankOf.get(b.team_number)!;
      if (a.place < b.place && !(ra < rb)) {
        throw new Error(`payout place ${a.place}(team ${a.team_number}, rank ${ra}) should outrank place ${b.place}(team ${b.team_number}, rank ${rb})`);
      }
      if (a.place === b.place && ra !== rb) {
        throw new Error(`teams ${a.team_number}/${b.team_number} share payout place ${a.place} but have ranks ${ra}/${rb}`);
      }
    }
  }
}
