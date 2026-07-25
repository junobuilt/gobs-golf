// Tournament data layer — READS. Every `rounds` read here is tournament-scoped
// (`.eq("tournament_id", …)`), never league-scoped; the isolation filter
// (Phase 1.1) keeps these rounds off league surfaces from the other direction.
//
// NOTE ON roundsQueryGuard: the source-scanning guard
// (tests/lib/round/roundsQueryGuard.test.ts) treats ANY `from("rounds")`
// statement whose window mentions the substring `tournament_id` as "guarded" —
// it does NOT distinguish `.is("tournament_id", null)` (league) from
// `.eq("tournament_id", id)` (tournament). So these reads need no allowlist
// entry. That imprecision is accepted for now and logged as tech debt (do not
// tighten the scanner this session); the intentional `.eq`-filtering of the
// tournament reads is documented-as-test in
// tests/lib/tournament/tournamentRoundsReads.test.ts.

import { supabase } from "@/lib/supabase";
import type {
  SessionRoundStatus,
  Tournament,
  TournamentPlayerJoined,
  TournamentSession,
  TournamentWithSessions,
} from "./types";

// The single active tournament (partial unique index `tournaments_only_one_active`
// guarantees at most one), or null.
export async function getActiveTournament(): Promise<Tournament | null> {
  const { data } = await supabase
    .from("tournaments")
    .select("*")
    .eq("is_active", true)
    .maybeSingle();
  return (data as Tournament | null) ?? null;
}

export async function getTournamentById(id: number): Promise<Tournament | null> {
  const { data } = await supabase
    .from("tournaments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as Tournament | null) ?? null;
}

// Assigned players joined to their `players` record (TD2 embed) so an
// already-assigned player renders even after being deactivated. Callers apply
// the array-vs-object guard on `.players`.
export async function getTournamentPlayers(
  tournamentId: number,
): Promise<TournamentPlayerJoined[]> {
  const { data } = await supabase
    .from("tournament_players")
    .select(
      "id, tournament_id, player_id, side, players ( id, full_name, display_name, handicap_index, is_active )",
    )
    .eq("tournament_id", tournamentId);
  return (data as unknown as TournamentPlayerJoined[] | null) ?? [];
}

export async function getTournamentSessions(
  tournamentId: number,
): Promise<TournamentSession[]> {
  const { data } = await supabase
    .from("tournament_sessions")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("day_number", { ascending: true });
  return (data as TournamentSession[] | null) ?? [];
}

// One batched read for the admin tab. Three small reads in parallel rather than
// a nested embed (the tournament tables aren't 1:1, and the batched shape is
// simpler for both the UI and the in-memory test fake).
export async function getTournamentWithSessions(
  tournamentId: number,
): Promise<TournamentWithSessions | null> {
  const [tournament, players, sessions] = await Promise.all([
    getTournamentById(tournamentId),
    getTournamentPlayers(tournamentId),
    getTournamentSessions(tournamentId),
  ]);
  if (!tournament) return null;
  return { tournament, players, sessions };
}

// Whether a session's backing round has real scores (blocks delete) and/or
// pairings (does NOT block). `scores` link via `round_players.round_id`;
// `team_scores` link directly by `round_id`. See §5.1.
export async function getSessionRoundStatus(
  roundId: number | null,
): Promise<SessionRoundStatus> {
  if (roundId == null) return { roundId: null, hasScores: false, hasPairings: false };

  const { data: rps } = await supabase
    .from("round_players")
    .select("id")
    .eq("round_id", roundId);
  const rpIds = (rps ?? []).map((r: { id: number }) => r.id);
  const hasPairings = rpIds.length > 0;

  let hasScores = false;
  if (rpIds.length > 0) {
    const { data: sc } = await supabase
      .from("scores")
      .select("id")
      .in("round_player_id", rpIds)
      .limit(1);
    hasScores = (sc ?? []).length > 0;
  }
  if (!hasScores) {
    const { data: ts } = await supabase
      .from("team_scores")
      .select("id")
      .eq("round_id", roundId)
      .limit(1);
    hasScores = (ts ?? []).length > 0;
  }

  return { roundId, hasScores, hasPairings };
}
