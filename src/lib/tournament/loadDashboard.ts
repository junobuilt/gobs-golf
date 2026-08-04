// Phase 4 dashboard loader — the tournament-wide roll-up.
//
// SSOT: this assembles NOTHING new. It fans out the canonical per-day loader
// (loadSessionMatches → LoadedMatch, each carrying `.state` from the engine and
// `.resolved` from resolveMatchResult) and feeds the ALREADY-EXISTING pure
// roll-up `computeTournamentStandings` (matchplay.ts). Every country point on
// the dashboard is `resolveMatchResult`'s authoritative result — admin override
// already applied — never a recompute. The headline cross-surface test asserts
// the dashboard total === Σ per-match resolved points + adjustments.
//
// No `from("rounds")` here (loadSessionMatches reads round_id off the session),
// so roundsQueryGuard is untouched.

import {
  getPointAdjustments,
  getTournamentSessions,
} from "./queries";
import { loadSessionMatches } from "./loadMatch";
import { computeTournamentStandings } from "./matchplay";
import type {
  LoadedMatch,
  Standings,
  StandingsMatchInput,
  TournamentPointAdjustment,
  TournamentSession,
} from "./types";

export interface DashboardDay {
  session: TournamentSession;
  matches: LoadedMatch[];
  // True when this day's loader threw (mixed tees / missing holes). The banked
  // total only counts the days that loaded; a broken day never blanks the page.
  error: boolean;
}

export interface DashboardData {
  standings: Standings; // banked (decided + adjustments) / projected / inPlay
  days: DashboardDay[];
  adjustments: TournamentPointAdjustment[];
}

// Map a canonical LoadedMatch to the roll-up's per-match input. `result` is the
// AUTHORITATIVE result (m.resolved.result — override already applied by
// resolveMatchResult); the live engine numbers (holesUp/thru/margin) feed the
// in-play list + projection.
function toStandingsInput(m: LoadedMatch): StandingsMatchInput {
  return {
    matchId: m.match.id,
    result: m.resolved.result,
    holesUp: m.state.holesUp,
    thru: m.state.thru,
    margin: m.state.margin,
  };
}

export async function loadDashboard(
  tournamentId: number,
  // S4 perf: every call site already holds the full tournament (side names
  // included) from getActiveTournament / getTournamentMode. Passing it threads
  // the names into each day's loadSessionMatches so the tournament name is NOT
  // re-fetched once per day. Omitted → each day fetches it (back-compat).
  tournament?: { id: number; side_a_name: string; side_b_name: string },
): Promise<DashboardData> {
  const sessions = await getTournamentSessions(tournamentId); // day-ordered
  // Per-day isolation (mirrors the landing): one misconfigured day shows a note,
  // never rejects the batch or corrupts the total.
  const [results, adjustments] = await Promise.all([
    Promise.allSettled(
      sessions.map((s) =>
        s.round_id != null ? loadSessionMatches(s.id, tournament) : Promise.resolve([] as LoadedMatch[]),
      ),
    ),
    getPointAdjustments(tournamentId),
  ]);

  const days: DashboardDay[] = sessions.map((session, i) => {
    const r = results[i];
    return r.status === "fulfilled"
      ? { session, matches: r.value, error: false }
      : { session, matches: [], error: true };
  });

  // Migration 040 — a voided match keeps its row (so createdCount still sees it)
  // but contributes NO country points: exclude it before the roll-up so the bar
  // fills agree with the void-aware liveTotal (cup.ts).
  const inputs: StandingsMatchInput[] = days.flatMap((d) =>
    d.matches.filter((m) => !m.match.is_voided).map(toStandingsInput),
  );
  const standings = computeTournamentStandings(inputs, adjustments);

  return { standings, days, adjustments };
}
