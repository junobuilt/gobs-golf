// F.1 — list-level loader for the History tab (global nav + admin Settings
// History). Returns every FINALIZED round's per-team rank / names / total.
//
// SINGLE SOURCE OF TRUTH: this is a *projection* of the canonical results
// engine — it calls loadRoundTeamsOnly once per round and selects only the
// fields the mini-leaderboard rows need. It does NOT re-fetch scores or re-run
// the ranking engine itself. (It used to batch-fetch all scores in one `.in()`
// and run the engine here; that query hit Supabase's 1000-row API cap on real
// data — 5k+ score rows — so newer rounds silently lost their scores and the
// list ranked the wrong team the winner. Per-round scope keeps each fetch small
// (one round's scores, well under the cap) and guarantees the list can never
// disagree with the summary. See the 2026-06-09 TD.)
//
// S4 perf: the per-round call is loadRoundTeamsOnly (a SEPARATE lightweight path
// that reuses the SAME total + rank SSOT helpers as loadRoundResults but skips
// all per-player detail the list never renders), and the two round-INVARIANT
// reads — the active-player roster (display names) and every tee's holes — are
// hoisted here and fetched ONCE for the whole list, then injected per round.
// teamsOnly's team rank/name/total equals the full path (tests/lib/round/
// teamsOnly.test.ts); the full loadRoundResults path is untouched. The big
// batch-rewrite (all rounds in a few chunked queries) stays a future TD.

import { loadRoundTeamsOnly, type TeamsOnlyTeamLine } from "@/lib/round/results";
import type { Format, HoleInfo } from "@/lib/scoring";
import type { PlayerLike } from "@/lib/players/displayName";
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

// Flights S3: one flight's ranked team lines, for the grouped History row.
// Single-flight rounds carry exactly one section.
export type HistoryFlightSection = {
  flightId: number;
  flightName: string;
  format: Format;
  teams: HistoryTeamLine[]; // ranked, ascending rank, within the flight
};

export type RoundListItem = {
  roundId: number;
  playedOn: string; // ISO date (rounds.played_on)
  format: Format; // PRIMARY flight format (back-compat top-of-row chip)
  hasBlindDraws: boolean;
  teams: HistoryTeamLine[]; // flat, section-ordered (FilteredRow looks up by player)
  // Flights S3 (additive): per-flight grouping for the default (full) row.
  sections: HistoryFlightSection[];
};

// Loads all finalized rounds, newest-first by played_on, each as a teamsOnly
// projection of the canonical engine output.
export async function loadRoundsList(): Promise<RoundListItem[]> {
  // Hoist the round-INVARIANT reads (active-player roster for display names +
  // every tee's holes) so the whole list fetches them ONCE, not once per round,
  // then inject them into each round's teamsOnly call. The finalized-rounds
  // query runs concurrently with both.
  const [{ data: rounds }, activeRoster, holesByTee] = await Promise.all([
    supabase
      .from("rounds")
      .select("id, played_on, is_complete")
      .eq("is_complete", true)
      .is("tournament_id", null) // History finalized list excludes tournament rounds
      .order("played_on", { ascending: false }),
    fetchActiveRoster(),
    fetchAllHolesByTee(),
  ]);

  const finalized = (rounds ?? []) as Array<{ id: number; played_on: string }>;
  if (finalized.length === 0) return [];

  const items = await Promise.all(
    finalized.map(async (round): Promise<RoundListItem | null> => {
      const outcome = await loadRoundTeamsOnly(round.id, { activeRoster, holesByTee });
      if (outcome.status !== "ok") return null; // no format / missing → skip
      const { data } = outcome;

      const toLine = (t: TeamsOnlyTeamLine): HistoryTeamLine => ({
        teamNumber: t.teamNumber,
        name: t.name,
        rosterDisplay: t.rosterDisplay,
        playerIds: t.playerIds,
        rank: t.rank,
        total: t.total,
        totalLabel: t.totalLabel,
        placeLabel: t.placeLabel,
      });

      // Per-flight sections, each ranked within the flight. Single-flight rounds
      // yield one section; the flat `teams` (section-ordered) matches today's
      // ranked list exactly.
      const sections: HistoryFlightSection[] = data.sections.map(s => ({
        flightId: s.flightId,
        flightName: s.flightName,
        format: s.format,
        teams: s.teams.slice().sort((a, b) => a.rank - b.rank).map(toLine),
      }));
      const teams: HistoryTeamLine[] = sections.flatMap(s => s.teams);

      return {
        roundId: round.id,
        playedOn: data.playedOn,
        format: data.format,
        hasBlindDraws: data.hasBlindDraws,
        teams,
        sections,
      };
    }),
  );

  // Preserve the newest-first order from the rounds query; drop skipped rounds.
  return items.filter((it): it is RoundListItem => it !== null);
}

// The active-player roster (display names only), fetched ONCE for the list.
async function fetchActiveRoster(): Promise<PlayerLike[]> {
  const { data } = await supabase
    .from("players")
    .select("id, full_name, is_active")
    .eq("is_active", true);
  return (data ?? []) as PlayerLike[];
}

// Every tee's holes, grouped by tee_id, fetched ONCE. The course has a handful
// of tees, so one read comfortably covers every round's allocation set.
async function fetchAllHolesByTee(): Promise<Record<number, HoleInfo[]>> {
  const { data } = await supabase
    .from("holes")
    .select("tee_id, hole_number, par, stroke_index")
    .order("hole_number");
  const byTee: Record<number, HoleInfo[]> = {};
  (data ?? []).forEach((row: any) => {
    (byTee[row.tee_id] ??= []).push({
      holeNumber: row.hole_number,
      par: row.par,
      strokeIndex: row.stroke_index,
    });
  });
  return byTee;
}
