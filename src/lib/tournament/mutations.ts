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
import { upsertTeamScore } from "@/lib/round/teamScoresIo";
import { DEFAULT_TEE_ID } from "@/lib/tees";
import { getDaySideAssignments, getSessionRoundStatus } from "./queries";
import type { MatchResult, Side, SessionFormat, Tournament, TournamentMatch, TournamentSession } from "./types";

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
      is_published: false, // default Test — not shown to players until Dad goes Live
    })
    .select("*")
    .single();
  if (error) throw new Error("createTournament: " + error.message);
  return data as Tournament;
}

export async function updateTournament(
  id: number,
  patch: Partial<
    Pick<Tournament, "name" | "side_a_name" | "side_b_name" | "holder_side" | "started_on" | "ended_on" | "is_published">
  >,
): Promise<void> {
  const { error } = await supabase.from("tournaments").update(patch).eq("id", id);
  if (error) throw new Error("updateTournament: " + error.message);
}

// Q4 relay: flip Test/Live. Thin wrapper over updateTournament so the admin
// toggle has an intention-revealing call.
export async function setTournamentPublished(id: number, isPublished: boolean): Promise<void> {
  await updateTournament(id, { is_published: isPublished });
}

// ── Phase 3.2 Relay B — scorer coordination metadata ─────────────────────────
// SOFT claim: who is currently scoring a match. Stored as the scorer's player_id
// (as text) in tournament_matches.scorer_label — an EXACT-identity check against
// the device's stored player_id (getStoredPlayerId), resilient to this league's
// duplicate first names. Coordination metadata ONLY: it never gates a score write
// (the claim is a signal, not a lock — a non-claimant takes over in one tap and
// writes). Best-effort; the 30s refresh reconciles from server truth. Pass null
// to release the claim.
export async function setMatchScorer(matchId: number, playerId: number | null): Promise<void> {
  const { error } = await supabase
    .from("tournament_matches")
    .update({ scorer_label: playerId == null ? null : String(playerId) })
    .eq("id", matchId);
  if (error) throw new Error("setMatchScorer: " + error.message);
}

// "Flag this hole" — the opposing side marks holes as needing a second look
// (suspected wrong scores) without seizing the scorer's control. Metadata ONLY:
// it never changes a score / status / outcome. Migration 037 widened this to
// tournament_matches.flagged_holes (int[]) so several holes can be flagged at
// once. Writes the WHOLE set (read-modify-write from the caller's optimistic
// state); pass [] to clear all. The scorer resolves a hole by correcting its
// score or dismissing it (the caller drops that element and re-writes the set).
export async function setMatchFlags(matchId: number, holes: number[]): Promise<void> {
  const { error } = await supabase
    .from("tournament_matches")
    .update({ flagged_holes: holes })
    .eq("id", matchId);
  if (error) throw new Error("setMatchFlags: " + error.message);
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

// A per-day override was requested for a player who isn't in this tournament.
// An override never grants membership (migration 038) — assign them under Sides
// first. Distinct from the pairing-time PlayerNotAssignedToSideError so the
// alternate-editor can show its own copy.
export class PlayerNotInTournamentError extends Error {
  readonly code = "player_not_in_tournament";
  constructor(public readonly playerId: number) {
    super(`setPlayerDaySide: player ${playerId} is not in this tournament`);
    this.name = "PlayerNotInTournamentError";
  }
}

// Set (or clear) a player's side FOR ONE DAY (migration 038). The sparse-override
// contract:
//  • `side === null` OR `side === home` → remove any override row (revert to
//    home; keeps the table sparse — "no row = home").
//  • `side !== home` → upsert the override (conflict key session_id,player_id).
// Membership is required: a player with no `tournament_players` row cannot get an
// override (throws PlayerNotInTournamentError). The home side is read from the
// SAME row so no extra query.
//
// FREEZE (surfaced by the caller, not enforced here): editing an override AFTER a
// match in this session is built does NOT re-side that built match — the match
// row is frozen at build time (like the CH/HI snapshots). The admin rebuilds the
// affected group; the PairingsPanel warns before applying such an edit.
export async function setPlayerDaySide(
  tournamentId: number,
  sessionId: number,
  playerId: number,
  side: Side | null,
): Promise<void> {
  // Membership gate + home lookup in one read.
  const { data: tp } = await supabase
    .from("tournament_players")
    .select("side")
    .eq("tournament_id", tournamentId)
    .eq("player_id", playerId)
    .maybeSingle();
  const home = (tp as { side: Side } | null)?.side ?? null;
  if (home == null) throw new PlayerNotInTournamentError(playerId);

  if (side === null || side === home) {
    // Revert to home → remove any override row (no row = home).
    const { error } = await supabase
      .from("tournament_day_sides")
      .delete()
      .eq("session_id", sessionId)
      .eq("player_id", playerId);
    if (error) throw new Error("setPlayerDaySide (clear): " + error.message);
    return;
  }

  const { error } = await supabase
    .from("tournament_day_sides")
    .upsert(
      { tournament_id: tournamentId, session_id: sessionId, player_id: playerId, side },
      { onConflict: "session_id,player_id" },
    );
  if (error) throw new Error("setPlayerDaySide: " + error.message);
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
// Day names are bare ("Day 1"/"Day 2"/"Day 3"); the format label is appended at
// render time from the FORMAT_LABEL SSOT (formatLabels.ts), so the format words
// live in exactly one place and never double-print against the stored name.
export const STANDARD_DAYS: ReadonlyArray<{ name: string; format: SessionFormat }> = [
  { name: "Day 1", format: "greensomes" },
  { name: "Day 2", format: "four_ball_match" },
  { name: "Day 3", format: "singles_match" },
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

// Per-day side eligibility now resolves through queries.getDaySideAssignments
// (home overlaid with migration-038 overrides), keyed by SESSION — so an
// alternate placed on the other side for one day validates correctly. The old
// raw `tournament_players.side`-only helper was removed; this is the single
// pairing-time read.

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

// Per-player round_players snapshot: HI + tee + course handicap. The tee is
// EXPLICIT (the group's tee, chosen at pairing time), overriding preferred_tee_id
// so a match can never span two tees — MixedTeesInMatchError becomes structurally
// impossible. CH is computed from that tee via computeCourseHandicap (the same
// path the scorecard uses); no new handicap math, no touching the league surfaces.
async function resolveSnapshots(playerIds: number[], teeId: number): Promise<Map<number, Snapshot>> {
  const out = new Map<number, Snapshot>();
  if (playerIds.length === 0) return out;
  const { data: players } = await supabase
    .from("players")
    .select("id, handicap_index")
    .in("id", playerIds);
  const { data: teeRow } = await supabase
    .from("tees")
    .select("slope_rating, course_rating, par")
    .eq("id", teeId)
    .maybeSingle();
  const tee = teeRow as { slope_rating: number; course_rating: number; par: number } | null;
  for (const p of (players ?? []) as Array<{ id: number; handicap_index: number | null }>) {
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
  // Slot arrays. `null` = an empty slot; for singles the INDEX is the pairing
  // (aIds[i] plays bIds[i]), so positions are preserved and nulls are not dropped.
  sideAPlayerIds: Array<number | null>;
  sideBPlayerIds: Array<number | null>;
  teeId: number;
  // Shotgun (039): the group's tee-off hole (1..18; null = ordinary hole-1 start)
  // and an optional label override (null = auto-derive from group_number). Both
  // stamped identically on every match in the group (singles: both 1-v-1s).
  startHole?: number | null;
  groupLabel?: string | null;
}): Promise<{ matches: TournamentMatch[]; teamNumbers: number[]; groupNumber: number }> {
  const session = await loadSessionCore(input.sessionId);
  const format = session.format; // session is the format authority
  const roundId = session.round_id as number;
  const aIds = [...input.sideAPlayerIds];
  const bIds = [...input.sideBPlayerIds];
  const presentA = aIds.filter((x): x is number => x != null);
  const presentB = bIds.filter((x): x is number => x != null);
  const present = [...presentA, ...presentB];

  if (present.length === 0) throw new EmptyGroupError(); // §5 floor
  if (presentA.length > 2) throw new GroupOverfilledError("a", presentA.length);
  if (presentB.length > 2) throw new GroupOverfilledError("b", presentB.length);

  // Intra-call duplicate (same player in two slots).
  if (new Set(present).size !== present.length) {
    const dup = present.find((id, i) => present.indexOf(id) !== i) as number;
    throw new PlayerAlreadyGroupedError(dup);
  }

  // Every present player eligible for the matching side ON THIS DAY (home
  // overlaid with 038 overrides), so an alternate placed on the other side today
  // validates correctly.
  const sideBy = await getDaySideAssignments(session.tournament_id, input.sessionId);
  const checkSide = (ids: number[], slot: Side) => {
    for (const id of ids) {
      const s = sideBy.get(id);
      if (s == null) throw new PlayerNotAssignedToSideError(id);
      if (s !== slot) throw new PlayerSideMismatchError(id, slot, s);
    }
  };
  checkSide(presentA, "a");
  checkSide(presentB, "b");

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
  for (const id of present) if (grouped.has(id)) throw new PlayerAlreadyGroupedError(id);

  const { data: existingMatches } = await supabase
    .from("tournament_matches")
    .select("match_number, group_number")
    .eq("session_id", input.sessionId);
  let maxMatchNo = 0;
  let maxGroupNo = 0;
  for (const m of (existingMatches ?? []) as Array<{ match_number: number; group_number: number | null }>) {
    if (m.match_number > maxMatchNo) maxMatchNo = m.match_number;
    if ((m.group_number ?? 0) > maxGroupNo) maxGroupNo = m.group_number ?? 0;
  }
  const groupNumber = maxGroupNo + 1;

  const snaps = await resolveSnapshots(present, input.teeId);
  let nextTeam = maxTeam + 1;
  const rpRows: Array<Record<string, unknown>> = [];
  const matchSpecs: Array<{ aTeam: number; bTeam: number }> = [];
  const pushRp = (playerId: number, teamNumber: number) => {
    const s = snaps.get(playerId);
    rpRows.push({
      round_id: roundId,
      player_id: playerId,
      team_number: teamNumber,
      tee_id: input.teeId, // the group's tee — every row stamped identically
      handicap_index_snapshot: s?.hi ?? null,
      course_handicap: s?.ch ?? null,
    });
  };

  if (format === "singles_match") {
    // One 1-v-1 match per PAIRING ROW (slot index encodes who plays whom). A row
    // with a single filled seat still makes a match (both team_numbers stamped) so
    // an override can land on it; a fully-empty row makes nothing.
    const rowCount = Math.max(aIds.length, bIds.length);
    for (let i = 0; i < rowCount; i++) {
      const a = aIds[i] ?? null;
      const b = bIds[i] ?? null;
      if (a == null && b == null) continue;
      const aTeam = nextTeam++;
      const bTeam = nextTeam++;
      if (a != null) pushRp(a, aTeam);
      if (b != null) pushRp(b, bTeam);
      matchSpecs.push({ aTeam, bTeam });
    }
  } else {
    const aTeam = nextTeam++;
    const bTeam = nextTeam++;
    for (const id of aIds) if (id != null) pushRp(id, aTeam);
    for (const id of bIds) if (id != null) pushRp(id, bTeam);
    matchSpecs.push({ aTeam, bTeam });
  }

  if (rpRows.length > 0) {
    const { error: rpErr } = await supabase.from("round_players").insert(rpRows);
    if (rpErr) throw new Error("createGroup (round_players): " + rpErr.message);
  }

  // Shotgun (039): normalize the label override — a blank/whitespace string is
  // treated as "no override" (null) so the display falls back to the derived
  // letter. start_hole out of 1..18 is ignored (null → hole-1 start).
  const labelOverride = input.groupLabel != null && input.groupLabel.trim() !== "" ? input.groupLabel.trim() : null;
  const startHole =
    input.startHole != null && Number.isInteger(input.startHole) && input.startHole >= 1 && input.startHole <= 18
      ? input.startHole
      : null;

  const matchRows = matchSpecs.map((spec, i) => ({
    tournament_id: session.tournament_id,
    session_id: input.sessionId,
    match_number: maxMatchNo + 1 + i,
    group_number: groupNumber, // singles: BOTH matches share this foursome id
    side_a_team_number: spec.aTeam,
    side_b_team_number: spec.bTeam,
    status: "pending" as const,
    result: null,
    result_source: "engine" as const,
    start_hole: startHole, // per-group tee-off hole (039)
    group_label: labelOverride, // null = auto-derive from group_number at display
  }));
  const { data: created, error: mErr } = await supabase.from("tournament_matches").insert(matchRows).select("*");
  if (mErr) throw new Error("createGroup (matches): " + mErr.message);

  return {
    matches: (created as TournamentMatch[] | null) ?? [],
    teamNumbers: matchSpecs.flatMap((s) => [s.aTeam, s.bTeam]),
    groupNumber,
  };
}

// All matches of a group (by group_number) and all their team numbers. A singles
// foursome has two matches sharing one group_number; greensomes/four-ball one.
async function groupMatches(sessionId: number, groupNumber: number): Promise<{ matchIds: number[]; teamNumbers: number[] }> {
  const { data } = await supabase
    .from("tournament_matches")
    .select("id, side_a_team_number, side_b_team_number")
    .eq("session_id", sessionId)
    .eq("group_number", groupNumber);
  const matchIds: number[] = [];
  const teams = new Set<number>();
  for (const m of (data ?? []) as Array<{ id: number; side_a_team_number: number; side_b_team_number: number }>) {
    matchIds.push(m.id);
    teams.add(m.side_a_team_number);
    teams.add(m.side_b_team_number);
  }
  return { matchIds, teamNumbers: [...teams] };
}

async function groupHasScores(roundId: number, teamNumbers: number[], format: SessionFormat): Promise<boolean> {
  for (const tn of teamNumbers) {
    if (await teamHasScores(roundId, tn, format)) return true;
  }
  return false;
}

// Edit a group — swap a seat and/or change the group's tee. Allowed only while
// the group has no scores. A swap is keyed on TEAM_NUMBER (never re-derived from
// slot index) so a singles swap leaves both matches' pairings untouched. A teeId
// restamps EVERY round_players row in the group and recomputes their course
// handicaps (a tee change can't create a mixed-tee match). The match rows are
// never rewritten.
export async function updateGroup(input: {
  sessionId: number;
  groupNumber: number;
  teamNumber?: number;
  fromPlayerId?: number;
  toPlayerId?: number;
  teeId?: number;
}): Promise<void> {
  const session = await loadSessionCore(input.sessionId);
  const roundId = session.round_id as number;

  const { teamNumbers } = await groupMatches(input.sessionId, input.groupNumber);
  if (await groupHasScores(roundId, teamNumbers, session.format)) throw new GroupHasScoresError();

  // Current group tee — the incoming swapped player inherits it unless teeId overrides.
  const { data: groupRows } = await supabase
    .from("round_players")
    .select("tee_id")
    .eq("round_id", roundId)
    .in("team_number", teamNumbers.length ? teamNumbers : [-1]);
  const currentTee = ((groupRows ?? []) as Array<{ tee_id: number | null }>).find((r) => r.tee_id != null)?.tee_id ?? DEFAULT_TEE_ID;
  const effectiveTee = input.teeId ?? currentTee;

  // Tee change → restamp every row in the group + recompute CH.
  if (input.teeId != null && teamNumbers.length > 0) {
    const { data: rows } = await supabase
      .from("round_players")
      .select("player_id")
      .eq("round_id", roundId)
      .in("team_number", teamNumbers);
    const playerIds = ((rows ?? []) as Array<{ player_id: number }>).map((r) => r.player_id);
    const snaps = await resolveSnapshots(playerIds, input.teeId);
    for (const pid of playerIds) {
      const snap = snaps.get(pid);
      const { error } = await supabase
        .from("round_players")
        .update({ tee_id: input.teeId, course_handicap: snap?.ch ?? null })
        .eq("round_id", roundId)
        .in("team_number", teamNumbers)
        .eq("player_id", pid);
      if (error) throw new Error("updateGroup (tee): " + error.message);
    }
  }

  // ── Seat operations (mutually exclusive): swap / fill / clear ────────────
  // An incoming player is validated exactly like create: on a side, matching the
  // slot's side, and not already grouped that day.
  const slotSide = input.teamNumber != null ? await sideOfTeamNumber(input.sessionId, input.teamNumber) : null;
  const validateIncoming = async (playerId: number) => {
    const sideBy = await getDaySideAssignments(session.tournament_id, input.sessionId);
    const s = sideBy.get(playerId);
    if (s == null) throw new PlayerNotAssignedToSideError(playerId);
    if (slotSide != null && s !== slotSide) throw new PlayerSideMismatchError(playerId, slotSide, s);
    const { data: existing } = await supabase
      .from("round_players")
      .select("player_id")
      .eq("round_id", roundId)
      .gt("team_number", 0);
    if (((existing ?? []) as Array<{ player_id: number }>).some((r) => r.player_id === playerId)) {
      throw new PlayerAlreadyGroupedError(playerId);
    }
  };

  if (input.teamNumber != null && input.fromPlayerId != null && input.toPlayerId != null) {
    // Swap an occupied seat for another player (team_number unchanged).
    if (input.toPlayerId !== input.fromPlayerId) await validateIncoming(input.toPlayerId);
    const snap = (await resolveSnapshots([input.toPlayerId], effectiveTee)).get(input.toPlayerId);
    const { error } = await supabase
      .from("round_players")
      .update({ player_id: input.toPlayerId, tee_id: effectiveTee, handicap_index_snapshot: snap?.hi ?? null, course_handicap: snap?.ch ?? null })
      .eq("round_id", roundId)
      .eq("team_number", input.teamNumber)
      .eq("player_id", input.fromPlayerId);
    if (error) throw new Error("updateGroup (swap): " + error.message);
  } else if (input.teamNumber != null && input.toPlayerId != null) {
    // Fill an empty seat — create the round_players row on that team_number,
    // stamped with the group's tee + CH, exactly as createGroup does.
    await validateIncoming(input.toPlayerId);
    const snap = (await resolveSnapshots([input.toPlayerId], effectiveTee)).get(input.toPlayerId);
    const { error } = await supabase.from("round_players").insert({
      round_id: roundId,
      player_id: input.toPlayerId,
      team_number: input.teamNumber,
      tee_id: effectiveTee,
      handicap_index_snapshot: snap?.hi ?? null,
      course_handicap: snap?.ch ?? null,
    });
    if (error) throw new Error("updateGroup (fill): " + error.message);
  } else if (input.teamNumber != null && input.fromPlayerId != null) {
    // Clear an occupied seat — delete the row; team_number (and the match /
    // group_number) stay. Clearing the group's LAST player is rejected (§5 floor).
    const { data: rows } = await supabase
      .from("round_players")
      .select("id")
      .eq("round_id", roundId)
      .in("team_number", teamNumbers.length ? teamNumbers : [-1]);
    if (((rows ?? []) as unknown[]).length <= 1) throw new EmptyGroupError();
    const { error } = await supabase
      .from("round_players")
      .delete()
      .eq("round_id", roundId)
      .eq("team_number", input.teamNumber)
      .eq("player_id", input.fromPlayerId);
    if (error) throw new Error("updateGroup (clear): " + error.message);
  }
}

// Remove a whole group by group_number: its matches and the round_players on
// those matches' team numbers. Blocked once any team in the group has scores.
export async function deleteGroup(input: { sessionId: number; groupNumber: number }): Promise<void> {
  const session = await loadSessionCore(input.sessionId);
  const roundId = session.round_id as number;

  const { matchIds, teamNumbers } = await groupMatches(input.sessionId, input.groupNumber);
  if (await groupHasScores(roundId, teamNumbers, session.format)) throw new GroupHasScoresError();

  if (matchIds.length > 0) {
    const { error: mErr } = await supabase.from("tournament_matches").delete().in("id", matchIds);
    if (mErr) throw new Error("deleteGroup (matches): " + mErr.message);
  }
  if (teamNumbers.length > 0) {
    const { error: rpErr } = await supabase
      .from("round_players")
      .delete()
      .eq("round_id", roundId)
      .in("team_number", teamNumbers);
    if (rpErr) throw new Error("deleteGroup (round_players): " + rpErr.message);
  }
}

// Shotgun (039): set the group's tee-off hole and/or label override, updating
// EVERY match in the group (singles: both 1-v-1s) so the foursome stays
// consistent. `startHole` null (or out of 1..18) → an ordinary hole-1 start;
// `groupLabel` null/blank → auto-derive from group_number at display. No scores
// gate — the engine recomputes play order / completion live, so an admin can fix
// a start hole mid-round. Pass only the keys to change.
export async function setGroupShotgun(
  sessionId: number,
  groupNumber: number,
  patch: { startHole?: number | null; groupLabel?: string | null },
): Promise<void> {
  const update: Record<string, unknown> = {};
  if ("startHole" in patch) {
    const sh = patch.startHole;
    update.start_hole = sh != null && Number.isInteger(sh) && sh >= 1 && sh <= 18 ? sh : null;
  }
  if ("groupLabel" in patch) {
    const gl = patch.groupLabel;
    update.group_label = gl != null && gl.trim() !== "" ? gl.trim() : null;
  }
  if (Object.keys(update).length === 0) return;
  const { error } = await supabase
    .from("tournament_matches")
    .update(update)
    .eq("session_id", sessionId)
    .eq("group_number", groupNumber);
  if (error) throw new Error("setGroupShotgun: " + error.message);
}

// ── Phase 4 — Admin overrides (3 levels) ────────────────────────────────────
// Ascending scope. Every write targets an EXISTING column/table; the canonical
// loader already surfaces each as authoritative (resolveMatchResult reads
// result_source/result; computeTournamentStandings folds point adjustments).
// Nothing here touches matchplay.ts, the scorecard surface, or a new column.

export class InvalidHoleScoreError extends Error {
  readonly code = "invalid_hole_score";
  constructor(message: string) {
    super(message);
    this.name = "InvalidHoleScoreError";
  }
}
export class InvalidPointAdjustmentError extends Error {
  readonly code = "invalid_point_adjustment";
  constructor(message: string) {
    super(message);
    this.name = "InvalidPointAdjustmentError";
  }
}

// LEVEL 1 — hole result: correct a player's strokes on one hole; the engine
// recomputes the hole outcome, points, status and margin canonically (a wrong
// hole outcome IS a wrong score, so fixing the score is the real fix). Scoped
// by (round_player_id, hole_number) — this is a SEPARATE, additive write path
// from the scorer surface's write queue; same `scores` table + conflict key.
// Individual formats (four-ball / singles) only — greensomes score lives on
// `team_scores`; a greensomes result is corrected with the Level-2 override.
export async function setMatchHoleScore(
  roundPlayerId: number,
  holeNumber: number,
  strokes: number,
): Promise<void> {
  if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) {
    throw new InvalidHoleScoreError(`hole must be 1–18, got ${holeNumber}`);
  }
  if (!Number.isInteger(strokes) || strokes < 1) {
    throw new InvalidHoleScoreError(`strokes must be a positive integer, got ${strokes}`);
  }
  const { error } = await supabase
    .from("scores")
    .upsert(
      { round_player_id: roundPlayerId, hole_number: holeNumber, strokes },
      { onConflict: "round_player_id,hole_number" },
    );
  if (error) throw new Error("setMatchHoleScore: " + error.message);
}

// LEVEL 1 (greensomes) — the alternate-shot twin of setMatchHoleScore. Greensomes
// plays ONE ball per side, so the correctable value is the SIDE's team score for a
// hole (there is no per-player score). Scoped by (round_id, team_number,
// hole_number) at ball_index = 1 — the SAME table + conflict key the live Day-1
// scorecard writes through (getTeamWriteQueue → team_scores upsert), so the engine
// recomputes the greensomes outcome canonically on the next load (loadMatch reads
// team_scores at ball_index = 1). A SEPARATE, additive write path from the scorer
// surface's write queue; never a second scoring path.
export async function setMatchTeamHoleScore(
  roundId: number,
  teamNumber: number,
  holeNumber: number,
  strokes: number,
): Promise<void> {
  if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) {
    throw new InvalidHoleScoreError(`hole must be 1–18, got ${holeNumber}`);
  }
  if (!Number.isInteger(strokes) || strokes < 1) {
    throw new InvalidHoleScoreError(`strokes must be a positive integer, got ${strokes}`);
  }
  await upsertTeamScore({ round_id: roundId, team_number: teamNumber, hole_number: holeNumber, ball_index: 1, strokes });
}

// LEVEL 2 — match result: force a winner/half, even with zero scores (the
// envelope rule). `result_source = 'admin'` makes resolveMatchResult honor the
// stored `result` UNCONDITIONALLY over the engine. Reversible via
// revertMatchResult. admin_note is the audit trail (the schema supports it here).
export async function overrideMatchResult(
  matchId: number,
  result: MatchResult,
  note: string | null,
): Promise<void> {
  if (result !== "side_a" && result !== "side_b" && result !== "halved") {
    throw new Error(`overrideMatchResult: invalid result ${result}`);
  }
  const trimmed = note != null && note.trim() !== "" ? note.trim() : null;
  const { error } = await supabase
    .from("tournament_matches")
    .update({ result, result_source: "admin", admin_note: trimmed })
    .eq("id", matchId);
  if (error) throw new Error("overrideMatchResult: " + error.message);
}

// Revert a match to the engine: clears the forced result + note so
// resolveMatchResult falls back to the live engine outcome.
export async function revertMatchResult(matchId: number): Promise<void> {
  const { error } = await supabase
    .from("tournament_matches")
    .update({ result: null, result_source: "engine", admin_note: null })
    .eq("id", matchId);
  if (error) throw new Error("revertMatchResult: " + error.message);
}

// LEVEL 3 — country points: a direct adjustment on `tournament_point_adjustments`
// (side 'a'/'b', points may be negative, reason required + non-blank).
// computeTournamentStandings folds it into `banked`. Reversible via
// deletePointAdjustment.
export async function addPointAdjustment(
  tournamentId: number,
  side: Side,
  points: number,
  reason: string,
): Promise<void> {
  if (side !== "a" && side !== "b") {
    throw new InvalidPointAdjustmentError(`side must be 'a' or 'b', got ${side}`);
  }
  if (!Number.isFinite(points) || points === 0) {
    throw new InvalidPointAdjustmentError(`points must be a non-zero number, got ${points}`);
  }
  const trimmed = reason?.trim() ?? "";
  if (trimmed === "") {
    throw new InvalidPointAdjustmentError("a reason is required");
  }
  const { error } = await supabase
    .from("tournament_point_adjustments")
    .insert({ tournament_id: tournamentId, side, points, reason: trimmed });
  if (error) throw new Error("addPointAdjustment: " + error.message);
}

export async function deletePointAdjustment(id: number): Promise<void> {
  const { error } = await supabase.from("tournament_point_adjustments").delete().eq("id", id);
  if (error) throw new Error("deletePointAdjustment: " + error.message);
}

// ── Phase 4 Commit C — self-serve safe teardown ─────────────────────────────
export interface TournamentTeardownResult {
  roundsDeleted: number;
  tournamentDeleted: boolean;
}

// Transactional + leak-safe teardown via the 035 SECURITY DEFINER RPC
// (delete_tournament_cascade): deletes the tournament's ROUNDS first (cascades
// scores/team_scores/round_players/sessions/matches), then the tournament row —
// every statement scoped to this tournament id, so a league round is physically
// unreachable. The SQL lives in the migration (not here), so this adds no
// `from("rounds")` to src/ and roundsQueryGuard is untouched.
export async function deleteTournament(id: number): Promise<TournamentTeardownResult> {
  const { data, error } = await supabase.rpc("delete_tournament_cascade", { p_tournament_id: id });
  if (error) throw new Error("deleteTournament: " + error.message);
  const row = (data ?? {}) as { rounds_deleted?: number; tournament_deleted?: boolean };
  return { roundsDeleted: row.rounds_deleted ?? 0, tournamentDeleted: row.tournament_deleted ?? false };
}
