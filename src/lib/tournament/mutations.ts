// Tournament data layer — WRITES.
//
// roundsQueryGuard: `ensureTournamentRound`'s rounds lookups + insert all
// mention `tournament_id` in-statement, and `deleteSession`'s round delete is
// scoped `.eq("tournament_id", …)` too — so every `from("rounds")` here is
// auto-guarded and needs no allowlist entry. (See queries.ts header for the
// accepted `.is`-vs-`.eq` scanner imprecision, logged as tech debt.)

import { supabase } from "@/lib/supabase";
import { addDaysISO, todayLocal } from "@/lib/date";
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

// A day's date can't be moved because ANOTHER day in the SAME tournament already
// owns it (`tournament_sessions_tournament_date_unique`, migration 032). Distinct
// from LeagueRoundOwnsDateError: that is a *league* round on the date; this is a
// sibling tournament day. They need different admin copy (§3.1).
export class TournamentDayDateTakenError extends Error {
  readonly code = "tournament_day_date_taken";
  constructor(public readonly date: string) {
    super(`editSession: another tournament day already owns ${date}`);
    this.name = "TournamentDayDateTakenError";
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
  // ended_on must never predate started_on. Ending a not-yet-started tournament
  // (today < started_on) records the start date instead of today. Migration 032
  // relaxed the CHECK to accept ending such a tournament, but the written value
  // must still be sane. Read started_on first.
  const { data: row, error: readErr } = await supabase
    .from("tournaments")
    .select("started_on")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw new Error("endTournament (read): " + readErr.message);
  const startedOn = (row as { started_on: string } | null)?.started_on ?? null;
  const today = todayLocal();
  const endedOn = startedOn && today < startedOn ? startedOn : today;

  const { error } = await supabase
    .from("tournaments")
    .update({ ended_on: endedOn, is_active: false })
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

// The three days this tournament always runs, in order. Auto-created on
// tournament creation (§3) on consecutive dates from started_on.
export const STANDARD_DAYS: ReadonlyArray<{ name: string; format: SessionFormat }> = [
  { name: "Day 1 — Greensomes", format: "greensomes" },
  { name: "Day 2 — Four-ball", format: "four_ball_match" },
  { name: "Day 3 — Singles", format: "singles_match" },
];

export interface FailedStandardDay {
  name: string;
  format: SessionFormat;
  date: string; // ISO
}

// Create the three standard days on CONSECUTIVE dates starting at startedOn. Each
// day is independent: if one date collides with a LEAGUE round the others still
// get created and the blocked day is returned in `failed` (name + format + date)
// so the caller can surface a banner naming what couldn't be placed (§3). Any
// non-collision error aborts (rethrows).
export async function createStandardDays(
  tournamentId: number,
  startedOn: string,
): Promise<{ created: TournamentSession[]; failed: FailedStandardDay[] }> {
  const created: TournamentSession[] = [];
  const failed: FailedStandardDay[] = [];
  for (let i = 0; i < STANDARD_DAYS.length; i++) {
    const spec = STANDARD_DAYS[i];
    const playedOn = addDaysISO(startedOn, i);
    try {
      const session = await createSession({
        tournamentId,
        dayNumber: i + 1,
        name: spec.name,
        format: spec.format,
        playedOn,
      });
      created.push(session);
    } catch (err) {
      if (err instanceof LeagueRoundOwnsDateError) {
        failed.push({ name: spec.name, format: spec.format, date: playedOn });
        continue;
      }
      throw err;
    }
  }
  return { created, failed };
}

// Edit a day's name / format / date. When the date changes the underlying round
// MOVES (never a second round) — and we let the two UNIQUE constraints classify a
// collision rather than pre-checking (a pre-check is racy and redundant):
//
//   1. Move the session row first. A 23505 here means the target date is owned by
//      another day in THIS tournament (tournament_sessions_tournament_date_unique)
//      — nothing has moved yet, so throw TournamentDayDateTakenError clean.
//   2. Move the round. A 23505 here means a LEAGUE round owns the date
//      (rounds_played_on_unique). The session already moved in step 1, so REVERT
//      it to origPlayedOn before throwing LeagueRoundOwnsDateError — otherwise the
//      session and its round would sit on different dates (an invisible broken day).
//   3. Apply name/format.
export async function editSession(
  session: Pick<TournamentSession, "id" | "tournament_id" | "round_id" | "played_on">,
  patch: { name: string; format: SessionFormat; playedOn: string },
): Promise<void> {
  const dateChanged = patch.playedOn !== session.played_on;

  if (dateChanged) {
    const origPlayedOn = session.played_on;

    // Step 1 — move the session row. 23505 ⇒ sibling tournament day owns the date.
    const { error: sessErr } = await supabase
      .from("tournament_sessions")
      .update({ played_on: patch.playedOn })
      .eq("id", session.id);
    if (sessErr) {
      if ((sessErr as { code?: string }).code === "23505") {
        throw new TournamentDayDateTakenError(patch.playedOn);
      }
      throw new Error("editSession (session move): " + sessErr.message);
    }

    // Step 2 — move the round. 23505 ⇒ a league round owns the date; revert step 1.
    if (session.round_id != null) {
      const { error: roundErr } = await supabase
        .from("rounds")
        .update({ played_on: patch.playedOn })
        .eq("id", session.round_id)
        .eq("tournament_id", session.tournament_id);
      if (roundErr) {
        await supabase
          .from("tournament_sessions")
          .update({ played_on: origPlayedOn })
          .eq("id", session.id);
        if ((roundErr as { code?: string }).code === "23505") {
          throw new LeagueRoundOwnsDateError(patch.playedOn);
        }
        throw new Error("editSession (round move): " + roundErr.message);
      }
    }
  }

  // Step 3 — name / format (and re-affirm played_on, harmless when unchanged).
  await updateSession(session.id, {
    name: patch.name,
    format: patch.format,
    played_on: patch.playedOn,
  });
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
