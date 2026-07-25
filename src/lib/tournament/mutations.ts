// Tournament data layer — WRITES.
//
// roundsQueryGuard: `ensureTournamentRound`'s rounds lookups + insert all
// mention `tournament_id` in-statement, and `deleteSession`'s round delete is
// scoped `.eq("tournament_id", …)` too — so every `from("rounds")` here is
// auto-guarded and needs no allowlist entry. (See queries.ts header for the
// accepted `.is`-vs-`.eq` scanner imprecision, logged as tech debt.)

import { supabase } from "@/lib/supabase";
import { addDaysISO, todayLocal } from "@/lib/date";
import { computeCourseHandicap } from "@/lib/scoring/handicap";
import { DEFAULT_TEE_ID } from "@/lib/tees";
import { getSessionRoundStatus } from "./queries";
import type { Side, SessionFormat, Tournament, TournamentMatch, TournamentSession } from "./types";

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

// ── Pairings (§2, Phase 2.2) ────────────────────────────────────────────────
// A "group" is Dad's foursome for a day. It materialises as `round_players` rows
// (each side is a team_number within the day's round) plus `tournament_matches`
// rows: ONE match for greensomes/four-ball (2-v-2), TWO for singles (each 1-v-1,
// paired BY SLOT INDEX at creation and thereafter identified only by the
// team_numbers stamped on the match rows). No `from("rounds")` in this section —
// so it adds nothing to roundsQueryGuard.

export class SessionRoundMissingError extends Error {
  readonly code = "session_round_missing";
  constructor(public readonly sessionId: number) {
    super(`pairings: session ${sessionId} has no round; create the day's round first`);
    this.name = "SessionRoundMissingError";
  }
}
export class EmptyGroupError extends Error {
  readonly code = "empty_group";
  constructor() {
    super("createGroup: a group needs at least one player");
    this.name = "EmptyGroupError";
  }
}
export class GroupOverfilledError extends Error {
  readonly code = "group_overfilled";
  constructor(public readonly side: Side, public readonly count: number) {
    super(`createGroup: side ${side} has ${count} players; a group is at most 2 per side`);
    this.name = "GroupOverfilledError";
  }
}
export class PlayerNotAssignedToSideError extends Error {
  readonly code = "player_not_assigned_to_side";
  constructor(public readonly playerId: number) {
    super(`pairings: player ${playerId} is not assigned to a side in this tournament`);
    this.name = "PlayerNotAssignedToSideError";
  }
}
export class PlayerSideMismatchError extends Error {
  readonly code = "player_side_mismatch";
  constructor(public readonly playerId: number, public readonly slotSide: Side, public readonly actualSide: Side) {
    super(`pairings: player ${playerId} is on side ${actualSide} but was placed on side ${slotSide}`);
    this.name = "PlayerSideMismatchError";
  }
}
export class PlayerAlreadyGroupedError extends Error {
  readonly code = "player_already_grouped";
  constructor(public readonly playerId: number) {
    super(`pairings: player ${playerId} is already in a group today`);
    this.name = "PlayerAlreadyGroupedError";
  }
}
export class GroupHasScoresError extends Error {
  readonly code = "group_has_scores";
  constructor() {
    super("pairings: this group has scores entered and can't be edited or removed");
    this.name = "GroupHasScoresError";
  }
}

interface SessionCore {
  id: number;
  tournament_id: number;
  round_id: number | null;
  format: SessionFormat;
}

async function loadSessionCore(sessionId: number): Promise<SessionCore> {
  const { data } = await supabase
    .from("tournament_sessions")
    .select("id, tournament_id, round_id, format")
    .eq("id", sessionId)
    .maybeSingle();
  const s = data as SessionCore | null;
  if (!s || s.round_id == null) throw new SessionRoundMissingError(sessionId);
  return s;
}

async function sideAssignments(tournamentId: number): Promise<Map<number, Side>> {
  const { data } = await supabase
    .from("tournament_players")
    .select("player_id, side")
    .eq("tournament_id", tournamentId);
  const m = new Map<number, Side>();
  for (const tp of (data ?? []) as Array<{ player_id: number; side: Side }>) m.set(tp.player_id, tp.side);
  return m;
}

// Which side a team_number is on within a session (a match's side_a vs side_b).
async function sideOfTeamNumber(sessionId: number, teamNumber: number): Promise<Side | null> {
  const { data } = await supabase
    .from("tournament_matches")
    .select("side_a_team_number, side_b_team_number")
    .eq("session_id", sessionId);
  for (const m of (data ?? []) as Array<{ side_a_team_number: number; side_b_team_number: number }>) {
    if (m.side_a_team_number === teamNumber) return "a";
    if (m.side_b_team_number === teamNumber) return "b";
  }
  return null;
}

// True if the given team_number carries any real score (individual or, for
// greensomes, team score). Scoped to ONE team so editing group B isn't blocked
// by group A having scores — "while the match has no scores" (§2).
async function teamHasScores(roundId: number, teamNumber: number, format: SessionFormat): Promise<boolean> {
  const { data: rps } = await supabase
    .from("round_players")
    .select("id")
    .eq("round_id", roundId)
    .eq("team_number", teamNumber);
  const rpIds = (rps ?? []).map((r: { id: number }) => r.id);
  if (rpIds.length > 0) {
    const { data: sc } = await supabase.from("scores").select("id").in("round_player_id", rpIds).limit(1);
    if ((sc ?? []).length > 0) return true;
  }
  if (format === "greensomes") {
    const { data: ts } = await supabase
      .from("team_scores")
      .select("id")
      .eq("round_id", roundId)
      .eq("team_number", teamNumber)
      .limit(1);
    if ((ts ?? []).length > 0) return true;
  }
  return false;
}

interface Snapshot {
  teeId: number;
  hi: number | null;
  ch: number | null;
}

// Per-player round_players snapshot: HI + tee + course handicap. There is NO
// single existing helper that writes all three (RoundSetup snapshots HI on
// check-in; the scorecard computes CH only when a tee is picked). This composes
// the SAME pieces — the tee fallback `preferred_tee_id ?? DEFAULT_TEE_ID` the
// scorecard uses, and `computeCourseHandicap` — without adding new handicap math
// and without touching the league surfaces.
async function resolveSnapshots(playerIds: number[]): Promise<Map<number, Snapshot>> {
  const out = new Map<number, Snapshot>();
  if (playerIds.length === 0) return out;
  const { data: players } = await supabase
    .from("players")
    .select("id, handicap_index, preferred_tee_id")
    .in("id", playerIds);
  const { data: tees } = await supabase.from("tees").select("id, slope_rating, course_rating, par");
  const teeById = new Map<number, { slope_rating: number; course_rating: number; par: number }>(
    ((tees ?? []) as Array<{ id: number; slope_rating: number; course_rating: number; par: number }>).map((t) => [t.id, t]),
  );
  for (const p of (players ?? []) as Array<{ id: number; handicap_index: number | null; preferred_tee_id: number | null }>) {
    const teeId = p.preferred_tee_id ?? DEFAULT_TEE_ID;
    const tee = teeById.get(teeId);
    const ch = tee ? computeCourseHandicap(p.handicap_index ?? null, tee.slope_rating, tee.course_rating, tee.par) : null;
    out.set(p.id, { teeId, hi: p.handicap_index ?? null, ch });
  }
  return out;
}

// Create a group: round_players for present players + the match row(s). Team
// numbers are allocated sequentially within the day's round (max+1), NEVER
// reused. Partial groups persist (a side short a player is `isIncomplete` in the
// loader) so an admin override — the envelope-rule halved — can land on the
// match; only a group with zero players total is rejected (§5).
export async function createGroup(input: {
  sessionId: number;
  format: SessionFormat;
  sideAPlayerIds: number[];
  sideBPlayerIds: number[];
}): Promise<{ matches: TournamentMatch[]; teamNumbers: number[] }> {
  const session = await loadSessionCore(input.sessionId);
  const format = session.format; // session is the format authority
  const roundId = session.round_id as number;
  const aIds = [...input.sideAPlayerIds];
  const bIds = [...input.sideBPlayerIds];
  const allIds = [...aIds, ...bIds];

  if (allIds.length === 0) throw new EmptyGroupError();
  if (aIds.length > 2) throw new GroupOverfilledError("a", aIds.length);
  if (bIds.length > 2) throw new GroupOverfilledError("b", bIds.length);

  // Intra-call duplicate (same player in two slots).
  if (new Set(allIds).size !== allIds.length) {
    const dup = allIds.find((id, i) => allIds.indexOf(id) !== i) as number;
    throw new PlayerAlreadyGroupedError(dup);
  }

  // Every player assigned to the matching side.
  const sideBy = await sideAssignments(session.tournament_id);
  const checkSide = (ids: number[], slot: Side) => {
    for (const id of ids) {
      const s = sideBy.get(id);
      if (s == null) throw new PlayerNotAssignedToSideError(id);
      if (s !== slot) throw new PlayerSideMismatchError(id, slot, s);
    }
  };
  checkSide(aIds, "a");
  checkSide(bIds, "b");

  // A player may be in only one group per day; find the team_number high-water.
  const { data: existingRps } = await supabase
    .from("round_players")
    .select("player_id, team_number")
    .eq("round_id", roundId)
    .gt("team_number", 0);
  let maxTeam = 0;
  const grouped = new Set<number>();
  for (const rp of (existingRps ?? []) as Array<{ player_id: number; team_number: number }>) {
    grouped.add(rp.player_id);
    if (rp.team_number > maxTeam) maxTeam = rp.team_number;
  }
  for (const id of allIds) if (grouped.has(id)) throw new PlayerAlreadyGroupedError(id);

  const { data: existingMatches } = await supabase
    .from("tournament_matches")
    .select("match_number")
    .eq("session_id", input.sessionId);
  let maxMatchNo = 0;
  for (const m of (existingMatches ?? []) as Array<{ match_number: number }>) {
    if (m.match_number > maxMatchNo) maxMatchNo = m.match_number;
  }

  const snaps = await resolveSnapshots(allIds);
  let nextTeam = maxTeam + 1;
  const rpRows: Array<Record<string, unknown>> = [];
  const matchSpecs: Array<{ aTeam: number; bTeam: number }> = [];
  const pushRp = (playerId: number, teamNumber: number) => {
    const s = snaps.get(playerId);
    rpRows.push({
      round_id: roundId,
      player_id: playerId,
      team_number: teamNumber,
      tee_id: s?.teeId ?? DEFAULT_TEE_ID,
      handicap_index_snapshot: s?.hi ?? null,
      course_handicap: s?.ch ?? null,
    });
  };

  if (format === "singles_match") {
    // One 1-v-1 match per slot index (Dad's ordering encodes the pairing). Both
    // team_numbers are stamped on the match even if a seat is empty — the match
    // must exist for an override to land on it.
    const matchCount = Math.max(aIds.length, bIds.length);
    for (let i = 0; i < matchCount; i++) {
      const aTeam = nextTeam++;
      const bTeam = nextTeam++;
      if (aIds[i] != null) pushRp(aIds[i], aTeam);
      if (bIds[i] != null) pushRp(bIds[i], bTeam);
      matchSpecs.push({ aTeam, bTeam });
    }
  } else {
    const aTeam = nextTeam++;
    const bTeam = nextTeam++;
    for (const id of aIds) pushRp(id, aTeam);
    for (const id of bIds) pushRp(id, bTeam);
    matchSpecs.push({ aTeam, bTeam });
  }

  if (rpRows.length > 0) {
    const { error: rpErr } = await supabase.from("round_players").insert(rpRows);
    if (rpErr) throw new Error("createGroup (round_players): " + rpErr.message);
  }

  const matchRows = matchSpecs.map((spec, i) => ({
    tournament_id: session.tournament_id,
    session_id: input.sessionId,
    match_number: maxMatchNo + 1 + i,
    side_a_team_number: spec.aTeam,
    side_b_team_number: spec.bTeam,
    status: "pending" as const,
    result: null,
    result_source: "engine" as const,
  }));
  const { data: created, error: mErr } = await supabase.from("tournament_matches").insert(matchRows).select("*");
  if (mErr) throw new Error("createGroup (matches): " + mErr.message);

  return {
    matches: (created as TournamentMatch[] | null) ?? [],
    teamNumbers: matchSpecs.flatMap((s) => [s.aTeam, s.bTeam]),
  };
}

// Swap the player occupying a team_number for another — allowed only while that
// team's match has no scores. Keyed on TEAM_NUMBER, never re-derived from slot
// index, so a singles swap leaves both matches' opponents (their team_numbers)
// untouched. The match rows are not written at all.
export async function updateGroup(input: {
  sessionId: number;
  teamNumber: number;
  fromPlayerId: number;
  toPlayerId: number;
}): Promise<void> {
  const session = await loadSessionCore(input.sessionId);
  const roundId = session.round_id as number;

  if (await teamHasScores(roundId, input.teamNumber, session.format)) throw new GroupHasScoresError();

  if (input.toPlayerId !== input.fromPlayerId) {
    const slotSide = await sideOfTeamNumber(input.sessionId, input.teamNumber);
    const sideBy = await sideAssignments(session.tournament_id);
    const s = sideBy.get(input.toPlayerId);
    if (s == null) throw new PlayerNotAssignedToSideError(input.toPlayerId);
    if (slotSide != null && s !== slotSide) throw new PlayerSideMismatchError(input.toPlayerId, slotSide, s);

    const { data: existing } = await supabase
      .from("round_players")
      .select("player_id")
      .eq("round_id", roundId)
      .gt("team_number", 0);
    if (((existing ?? []) as Array<{ player_id: number }>).some((r) => r.player_id === input.toPlayerId)) {
      throw new PlayerAlreadyGroupedError(input.toPlayerId);
    }
  }

  const snaps = await resolveSnapshots([input.toPlayerId]);
  const snap = snaps.get(input.toPlayerId);
  const { error } = await supabase
    .from("round_players")
    .update({
      player_id: input.toPlayerId,
      tee_id: snap?.teeId ?? DEFAULT_TEE_ID,
      handicap_index_snapshot: snap?.hi ?? null,
      course_handicap: snap?.ch ?? null,
    })
    .eq("round_id", roundId)
    .eq("team_number", input.teamNumber)
    .eq("player_id", input.fromPlayerId);
  if (error) throw new Error("updateGroup: " + error.message);
}

// Remove a group: its matches and the round_players on those matches' team
// numbers. Blocked once any involved team has scores — same rule as delete-day.
export async function deleteGroup(input: { sessionId: number; matchIds: number[] }): Promise<void> {
  const session = await loadSessionCore(input.sessionId);
  const roundId = session.round_id as number;

  const { data: matchRows } = await supabase
    .from("tournament_matches")
    .select("id, side_a_team_number, side_b_team_number")
    .in("id", input.matchIds);
  const teams = new Set<number>();
  for (const m of (matchRows ?? []) as Array<{ side_a_team_number: number; side_b_team_number: number }>) {
    teams.add(m.side_a_team_number);
    teams.add(m.side_b_team_number);
  }

  for (const tn of teams) {
    if (await teamHasScores(roundId, tn, session.format)) throw new GroupHasScoresError();
  }

  if (input.matchIds.length > 0) {
    const { error: mErr } = await supabase.from("tournament_matches").delete().in("id", input.matchIds);
    if (mErr) throw new Error("deleteGroup (matches): " + mErr.message);
  }
  if (teams.size > 0) {
    const { error: rpErr } = await supabase
      .from("round_players")
      .delete()
      .eq("round_id", roundId)
      .in("team_number", [...teams]);
    if (rpErr) throw new Error("deleteGroup (round_players): " + rpErr.message);
  }
}
