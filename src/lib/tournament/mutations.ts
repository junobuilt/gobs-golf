// Tournament data layer — WRITES.
//
// roundsQueryGuard: `ensureTournamentRound`'s rounds lookups + insert all
// mention `tournament_id` in-statement, and `deleteSession`'s round delete is
// scoped `.eq("tournament_id", …)` too — so every `from("rounds")` here is
// auto-guarded and needs no allowlist entry. (See queries.ts header for the
// accepted `.is`-vs-`.eq` scanner imprecision, logged as tech debt.)

import { supabase } from "@/lib/supabase";
import { todayLocal } from "@/lib/date";
import { getSessionRoundStatus } from "./queries";
import type { Side, SessionFormat, Tournament, TournamentSession } from "./types";

// Mirrors TournamentOwnsDateError (ensureRoundShell.ts). A tournament day's
// round cannot be created because a LEAGUE round already owns that date
// (`rounds_played_on_unique`, left intact by migration 031).
export class LeagueRoundOwnsDateError extends Error {
  readonly code = "league_round_owns_date";
  constructor(public readonly date: string) {
    super(`ensureTournamentRound: a league round owns ${date}; no tournament round can be created`);
    this.name = "LeagueRoundOwnsDateError";
  }
}

// Refuses to delete a day whose round already carries real scores (§5.1).
export class SessionHasScoresError extends Error {
  readonly code = "session_has_scores";
  constructor(public readonly sessionId: number) {
    super(`deleteSession: session ${sessionId} has scores entered and cannot be deleted`);
    this.name = "SessionHasScoresError";
  }
}

// Find-or-create the tournament-owned round for a date. NOT ensureRoundShell —
// that is league-scoped (filters tournament_id IS NULL and would throw
// TournamentOwnsDateError here). Tournament rounds carry tournament_id set,
// season_id NULL, format NULL, and get NO primary flight (flights are league).
export async function ensureTournamentRound(
  tournamentId: number,
  playedOn: string,
): Promise<number> {
  const { data: existing } = await supabase
    .from("rounds")
    .select("id")
    .eq("played_on", playedOn)
    .eq("tournament_id", tournamentId)
    .maybeSingle();
  if (existing) return (existing as { id: number }).id;

  const { data: round, error } = await supabase
    .from("rounds")
    .insert({
      played_on: playedOn,
      course_id: 1,
      tournament_id: tournamentId,
      season_id: null,
      format: null,
      format_config: {},
    })
    .select("id")
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      // A LEAGUE round owns this date (played_on is globally unique). Re-fetch
      // tournament-scoped; still empty ⇒ the colliding row is a league round.
      const { data: refetched } = await supabase
        .from("rounds")
        .select("id")
        .eq("played_on", playedOn)
        .eq("tournament_id", tournamentId)
        .maybeSingle();
      if (refetched) return (refetched as { id: number }).id;
      throw new LeagueRoundOwnsDateError(playedOn);
    }
    throw new Error("ensureTournamentRound: " + error.message);
  }
  if (!round) throw new Error("ensureTournamentRound: no row returned");
  return (round as { id: number }).id;
}

// ── Tournament CRUD ─────────────────────────────────────────────────────────
export async function createTournament(input: {
  name: string;
  startedOn: string;
  sideAName: string;
  sideBName: string;
  holderSide: Side | null;
}): Promise<Tournament> {
  const { data, error } = await supabase
    .from("tournaments")
    .insert({
      name: input.name,
      started_on: input.startedOn,
      side_a_name: input.sideAName,
      side_b_name: input.sideBName,
      holder_side: input.holderSide,
      is_active: true,
    })
    .select("*")
    .single();
  if (error) throw new Error("createTournament: " + error.message);
  return data as Tournament;
}

export async function updateTournament(
  id: number,
  patch: Partial<
    Pick<Tournament, "name" | "side_a_name" | "side_b_name" | "holder_side" | "started_on" | "ended_on">
  >,
): Promise<void> {
  const { error } = await supabase.from("tournaments").update(patch).eq("id", id);
  if (error) throw new Error("updateTournament: " + error.message);
}

export async function endTournament(id: number): Promise<void> {
  const { error } = await supabase
    .from("tournaments")
    .update({ ended_on: todayLocal(), is_active: false })
    .eq("id", id);
  if (error) throw new Error("endTournament: " + error.message);
}

// Upsert a player's side, or remove them when side is null. Upsert conflict key
// is the (tournament_id, player_id) unique constraint (migration 031).
export async function setPlayerSide(
  tournamentId: number,
  playerId: number,
  side: Side | null,
): Promise<void> {
  if (side === null) {
    const { error } = await supabase
      .from("tournament_players")
      .delete()
      .eq("tournament_id", tournamentId)
      .eq("player_id", playerId);
    if (error) throw new Error("setPlayerSide (remove): " + error.message);
    return;
  }
  const { error } = await supabase
    .from("tournament_players")
    .upsert(
      { tournament_id: tournamentId, player_id: playerId, side },
      { onConflict: "tournament_id,player_id" },
    );
  if (error) throw new Error("setPlayerSide: " + error.message);
}

// ── Sessions (days) ─────────────────────────────────────────────────────────
export async function createSession(input: {
  tournamentId: number;
  dayNumber: number;
  name: string;
  format: SessionFormat;
  playedOn: string;
}): Promise<TournamentSession> {
  // Create the day's tournament-owned round first, then store its id on the
  // session. LeagueRoundOwnsDateError propagates to the caller for friendly copy.
  const roundId = await ensureTournamentRound(input.tournamentId, input.playedOn);

  const { data, error } = await supabase
    .from("tournament_sessions")
    .insert({
      tournament_id: input.tournamentId,
      round_id: roundId,
      day_number: input.dayNumber,
      name: input.name,
      format: input.format,
      played_on: input.playedOn,
    })
    .select("*")
    .single();
  if (error) throw new Error("createSession: " + error.message);
  return data as TournamentSession;
}

export async function updateSession(
  id: number,
  patch: Partial<Pick<TournamentSession, "name" | "format" | "played_on" | "day_number" | "is_locked">>,
): Promise<void> {
  const { error } = await supabase.from("tournament_sessions").update(patch).eq("id", id);
  if (error) throw new Error("updateSession: " + error.message);
}

// Delete a day. Refuses when the round has real scores (§5.1); otherwise deletes
// the session AND its empty round (round_players/pairings cascade via ON DELETE
// CASCADE). Deleting the round is scoped by tournament_id — never a league round.
export async function deleteSession(id: number): Promise<{ roundDeleted: boolean }> {
  const { data: session } = await supabase
    .from("tournament_sessions")
    .select("id, round_id, tournament_id")
    .eq("id", id)
    .maybeSingle();
  if (!session) return { roundDeleted: false };
  const roundId = (session as { round_id: number | null }).round_id;
  const tournamentId = (session as { tournament_id: number }).tournament_id;

  if (roundId != null) {
    const status = await getSessionRoundStatus(roundId);
    if (status.hasScores) throw new SessionHasScoresError(id);
  }

  // Session first: tournament_sessions.round_id is ON DELETE SET NULL, so
  // deleting the round first would transiently null a row we're removing anyway.
  const { error: delSessErr } = await supabase.from("tournament_sessions").delete().eq("id", id);
  if (delSessErr) throw new Error("deleteSession: " + delSessErr.message);

  if (roundId != null) {
    const { error: delRoundErr } = await supabase
      .from("rounds")
      .delete()
      .eq("id", roundId)
      .eq("tournament_id", tournamentId);
    if (delRoundErr) throw new Error("deleteSession (round): " + delRoundErr.message);
    return { roundDeleted: true };
  }
  return { roundDeleted: false };
}
