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
  Side,
  Tournament,
  TournamentDaySide,
  TournamentPlayerJoined,
  TournamentPointAdjustment,
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

// ── Per-day side resolver (migration 038) — THE canonical read ──────────────
// A player's side FOR ONE DAY is: the sparse `tournament_day_sides` override for
// that (session, player) if present, else their home `tournament_players.side`.
// This mirrors the Flights `getFlightForTeam` default-to-home rule. Every
// pairing-time consumer (createGroup/updateGroup validation, the PairingsPanel
// pool filter) reads through here — none reads `tournament_players.side` raw for
// a per-day decision. An override NEVER grants membership: a player with no
// `tournament_players` row is not in the returned map even if a stray override
// row exists (defense in depth; setPlayerDaySide also refuses to write one).

// Raw override rows for one day (session) — feeds the alternate-editor UI's
// "who differs from home" marker. Oldest first is irrelevant (one row per
// player), so no order.
export async function getTournamentDaySides(
  sessionId: number,
): Promise<TournamentDaySide[]> {
  const { data } = await supabase
    .from("tournament_day_sides")
    .select("*")
    .eq("session_id", sessionId);
  return (data as TournamentDaySide[] | null) ?? [];
}

// The EFFECTIVE side for every participant on one day: home map overlaid with
// that day's overrides. Overrides for non-members are ignored (the home map
// gates membership). This batch form replaces the old raw side read at every
// pairing-time call site.
export async function getDaySideAssignments(
  tournamentId: number,
  sessionId: number,
): Promise<Map<number, Side>> {
  const [homeRes, overrideRes] = await Promise.all([
    supabase
      .from("tournament_players")
      .select("player_id, side")
      .eq("tournament_id", tournamentId),
    supabase
      .from("tournament_day_sides")
      .select("player_id, side")
      .eq("session_id", sessionId),
  ]);
  const map = new Map<number, Side>();
  for (const tp of (homeRes.data ?? []) as Array<{ player_id: number; side: Side }>) {
    map.set(tp.player_id, tp.side);
  }
  for (const o of (overrideRes.data ?? []) as Array<{ player_id: number; side: Side }>) {
    // Only re-side an existing MEMBER — an override never grants membership.
    if (map.has(o.player_id)) map.set(o.player_id, o.side);
  }
  return map;
}

// Single-player convenience over the same batch (SSOT: one resolution path).
// null when the player is not a tournament member on that day.
export async function getPlayerTeamForDay(
  tournamentId: number,
  sessionId: number,
  playerId: number,
): Promise<Side | null> {
  const map = await getDaySideAssignments(tournamentId, sessionId);
  return map.get(playerId) ?? null;
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

// Level-3 admin override read (Phase 4): all direct country-points adjustments
// for a tournament, oldest first. Feeds computeTournamentStandings (which reads
// only `side` + `points`) AND the admin list (which needs id/reason to remove).
export async function getPointAdjustments(
  tournamentId: number,
): Promise<TournamentPointAdjustment[]> {
  const { data } = await supabase
    .from("tournament_point_adjustments")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: true });
  return (data as TournamentPointAdjustment[] | null) ?? [];
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

// Total score rows on a day's round — individual `scores` (via the round's
// `round_players`) plus `team_scores` (greensomes) — for the delete-day confirm
// copy ("… N scores …"). Display-only; not a safety gate. A single day's rows
// are bounded (~20 players × 18 holes), well under the 1000-row cap, so counting
// ids by length is safe here.
export async function countDayScores(roundId: number | null): Promise<number> {
  if (roundId == null) return 0;

  const { data: rps } = await supabase
    .from("round_players")
    .select("id")
    .eq("round_id", roundId);
  const rpIds = (rps ?? []).map((r: { id: number }) => r.id);

  let count = 0;
  if (rpIds.length > 0) {
    const { data: sc } = await supabase
      .from("scores")
      .select("id")
      .in("round_player_id", rpIds);
    count += (sc ?? []).length;
  }
  const { data: ts } = await supabase
    .from("team_scores")
    .select("id")
    .eq("round_id", roundId);
  count += (ts ?? []).length;

  return count;
}
