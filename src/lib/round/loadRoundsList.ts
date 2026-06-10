// F.1 — list-level loader for the History tab (global nav + admin Settings
// History). Returns every FINALIZED round's per-team rank / names / total.
//
// SINGLE SOURCE OF TRUTH: this is a *projection* of loadRoundResults — it calls
// the canonical results loader once per round and selects only the fields the
// mini-leaderboard rows need. It does NOT re-fetch scores or re-run the ranking
// engine itself. (It used to batch-fetch all scores in one `.in()` and run the
// engine here; that query hit Supabase's 1000-row API cap on real data — 5k+
// score rows — so newer rounds silently lost their scores and the list ranked
// the wrong team the winner. Reusing loadRoundResults per round keeps each
// fetch small (one round's scores, well under the cap) and guarantees the list
// can never disagree with the summary. See the 2026-06-09 TD.)
//
// Perf note: this runs the full results engine ~21× (one per finalized round),
// in parallel. A trimmed `loadRoundResults(id, { teamsOnly })` mode that skips
// the per-player detail is logged as a perf TD — correctness first.

import { loadRoundResults } from "@/lib/round/results";
import type { Format } from "@/lib/scoring";
import { supabase } from "@/lib/supabase";

// One ranked team line on a History row.
export type HistoryTeamLine = {
  teamNumber: number;
  name: string; // "Team N"
  rosterDisplay: string; // disambiguated short names, " · "-joined
  playerIds: number[]; // players.id on this team — drives the player filter
  rank: number;
  total: number;
  totalLabel: string; // "−4" / "E" / "12 pts" — same as the detail headline
  placeLabel: string; // "6th of 8" / "T2 of 8"
};

export type RoundListItem = {
  roundId: number;
  playedOn: string; // ISO date (rounds.played_on)
  format: Format;
  hasBlindDraws: boolean;
  teams: HistoryTeamLine[]; // ranked, ascending rank
};

// Loads all finalized rounds, newest-first by played_on, each as a projection
// of its canonical loadRoundResults output.
export async function loadRoundsList(): Promise<RoundListItem[]> {
  // Just the ids + dates here; loadRoundResults re-reads everything else per round.
  const { data: rounds } = await supabase
    .from("rounds")
    .select("id, played_on, is_complete")
    .eq("is_complete", true)
    .order("played_on", { ascending: false });

  const finalized = (rounds ?? []) as Array<{ id: number; played_on: string }>;
  if (finalized.length === 0) return [];

  const items = await Promise.all(
    finalized.map(async (round): Promise<RoundListItem | null> => {
      const outcome = await loadRoundResults(round.id);
      if (outcome.status !== "ok") return null; // no format / missing → skip
      const { data } = outcome;

      const teams: HistoryTeamLine[] = data.teams
        .slice()
        .sort((a, b) => a.rank - b.rank)
        .map(t => ({
          teamNumber: t.id,
          name: t.name,
          rosterDisplay: t.rosterDisplay,
          playerIds: t.players.map(p => p.playerId),
          rank: t.rank,
          total: t.total,
          totalLabel: t.totalLabel,
          placeLabel: t.placeLabel,
        }));

      return {
        roundId: round.id,
        playedOn: data.playedOn,
        format: data.format,
        hasBlindDraws: data.teams.some(t => t.blindDraws.length > 0),
        teams,
      };
    }),
  );

  // Preserve the newest-first order from the rounds query; drop skipped rounds.
  return items.filter((it): it is RoundListItem => it !== null);
}
