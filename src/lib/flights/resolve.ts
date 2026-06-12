import { supabase } from "@/lib/supabase";
import type { Format, FormatConfig } from "@/lib/scoring/types";
import { DEFAULT_FORMAT_CONFIG_SHELL } from "@/lib/format/copy";
import { effectiveTeamConfig } from "@/lib/format/helpers";

// ─── Per-team handicap allowance override ────────────────────────────────────
// A flight owns one handicap allowance. An admin may OPT-IN to override the
// allowance for an INDIVIDUAL team (e.g. a no-show shrinks one team). The
// override is stored on flight_teams.handicap_allowance (nullable; NULL = inherit
// the flight default). THE rule — a team's EFFECTIVE config is its flight's
// config with the per-team allowance substituted in when present — lives in
// `effectiveTeamConfig` (src/lib/format/helpers.ts, the allowance home, kept
// supabase-free so the pure scoring core can use it). It is re-exported here so
// the flight surfaces import it alongside the resolvers below. Every surface
// routes through it (directly or via the accessors below); when no team has an
// override, the effective config IS the flight config (golden-safe).
export { effectiveTeamConfig };

// ─────────────────────────────────────────────────────────────────────────────
// Flights — the single source of truth for format ownership (Session 1).
//
// A "flight" is a sub-competition within a round. As of the Flights Track it
// OWNS the format, the format-behavior config keys (scoring_basis, basis,
// best_n, point_values, override_holes, handicap_allowance, team_ball_count),
// and the format lock. The round is a container (date / course / season) and
// keeps only the ROUND-level config key `submitted_teams`.
//
// CANONICAL DEFAULT RULE (lives HERE and nowhere else):
//   A team with no `flight_teams` row belongs to the round's FIRST flight —
//   the one with the lowest sort_order. Session 1 backfills exactly one flight
//   ("Flight A", sort_order 1) per round and writes NO flight_teams rows, so
//   every team resolves to Flight A and the app behaves identically to before
//   the move. Session 2 starts writing flight_teams rows; this rule then routes
//   only the explicitly-unassigned teams.
//
// No caller may read `rounds.format` / the flight-level keys of
// `rounds.format_config` / `rounds.format_locked_at` after Session 1. They are
// frozen legacy columns. Read format/config/lock through THIS module instead.
//
// Allowance note: there is still exactly ONE allowance accessor —
// `getPlayingCourseHandicap` / `getHandicapAllowance` in src/lib/format/helpers.ts.
// This module does NOT reimplement allowance math; callers source the
// FormatConfig from the resolved flight (via `flightConfig`) and feed it into
// those existing single-source helpers.
// ─────────────────────────────────────────────────────────────────────────────

export type Flight = {
  id: number;
  round_id: number;
  name: string;
  sort_order: number;
  format: Format | null;
  format_config: FormatConfig | null;
  format_locked_at: string | null;
};

export const FLIGHT_COLUMNS =
  "id, round_id, name, sort_order, format, format_config, format_locked_at";

export function rowToFlight(row: Record<string, unknown>): Flight {
  return {
    id: row.id as number,
    round_id: row.round_id as number,
    name: (row.name ?? "") as string,
    sort_order: row.sort_order as number,
    format: (row.format ?? null) as Format | null,
    format_config: (row.format_config ?? null) as FormatConfig | null,
    format_locked_at: (row.format_locked_at ?? null) as string | null,
  };
}

// All flights for a round, ordered by sort_order ascending (so [0] is the
// primary / first flight — the default-rule target).
export async function getFlightsForRound(roundId: number): Promise<Flight[]> {
  const { data } = await supabase
    .from("flights")
    .select(FLIGHT_COLUMNS)
    .eq("round_id", roundId)
    .order("sort_order", { ascending: true });
  return ((data ?? []) as Record<string, unknown>[]).map(rowToFlight);
}

// The round's primary (lowest sort_order) flight, or null if the round has no
// flights (should not happen post-022 + ensureRoundShell, which guarantees a
// Flight A exists for every round). Single-round callers (scorecard, team-card,
// RoundSetup, leaderboard, FormatPicker save) use this.
export async function getPrimaryFlightForRound(
  roundId: number,
): Promise<Flight | null> {
  const { data } = await supabase
    .from("flights")
    .select(FLIGHT_COLUMNS)
    .eq("round_id", roundId)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? rowToFlight(data as Record<string, unknown>) : null;
}

// The flight a given team plays in. CANONICAL DEFAULT RULE (see module header):
// an explicit flight_teams row wins; otherwise the team belongs to the round's
// first flight (lowest sort_order). Returns null only if the round has no
// flights at all.
export async function getFlightForTeam(
  roundId: number,
  teamNumber: number,
): Promise<Flight | null> {
  const flights = await getFlightsForRound(roundId);
  if (flights.length === 0) return null;

  const { data: mapping } = await supabase
    .from("flight_teams")
    .select("flight_id")
    .eq("round_id", roundId)
    .eq("team_number", teamNumber)
    .maybeSingle();

  if (mapping) {
    const explicit = flights.find(f => f.id === (mapping.flight_id as number));
    if (explicit) return explicit;
    // Mapping points at a flight not in this round (shouldn't happen) — fall
    // through to the default rule rather than returning null.
  }

  // Default rule: lowest sort_order. flights is already sorted ascending.
  return flights[0];
}

// Single-team EFFECTIVE config: the team's flight (canonical default rule) + its
// per-team allowance override (if any) folded in via `effectiveTeamConfig`. The
// per-team scoring surfaces (scorecard, team-card) use this so their PH/dots/net
// reflect an override without recomputing the rule. `allowanceOverride` is the
// raw stored value (null = inheriting the flight default), surfaced for display
// (the override marker).
export async function getTeamConfig(
  roundId: number,
  teamNumber: number,
): Promise<{
  flight: Flight | null;
  config: FormatConfig | null;
  allowanceOverride: number | null;
}> {
  const flight = await getFlightForTeam(roundId, teamNumber);
  const { data: ft } = await supabase
    .from("flight_teams")
    .select("handicap_allowance")
    .eq("round_id", roundId)
    .eq("team_number", teamNumber)
    .maybeSingle();
  const allowanceOverride =
    (ft?.handicap_allowance as number | null | undefined) ?? null;
  return {
    flight,
    config: effectiveTeamConfig(flight?.format_config ?? null, allowanceOverride),
    allowanceOverride,
  };
}

// Round-wide map team_number → per-team allowance override (only teams that HAVE
// an explicit non-null override appear). One small flight_teams read. Used by
// loadRoundResults (to thread the override through the engine) and RoundSetup (to
// render each team's effective allowance + marker).
export async function getTeamAllowanceOverrides(
  roundId: number,
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const { data } = await supabase
    .from("flight_teams")
    .select("team_number, handicap_allowance")
    .eq("round_id", roundId);
  for (const r of (data ?? []) as {
    team_number: number;
    handicap_allowance: number | null;
  }[]) {
    if (r.handicap_allowance != null) map.set(r.team_number, r.handicap_allowance);
  }
  return map;
}

// Resolve EVERY assigned team in a round to its flight, as a
// Map<teamNumber, Flight>. THE shared per-round resolver (Session 2): the admin
// Round Setup flight grouping, the delete-empty-flight check, and the
// multi-flight finalize guard all read from this so they agree on the same
// default rule. Applies the canonical rule (no flight_teams row → the round's
// first flight) once, in bulk, rather than N getFlightForTeam round-trips.
export async function getTeamFlightMap(
  roundId: number,
): Promise<Map<number, Flight>> {
  const map = new Map<number, Flight>();
  const flights = await getFlightsForRound(roundId);
  if (flights.length === 0) return map;

  const primary = flights[0]; // lowest sort_order (default-rule target)
  const byId = new Map(flights.map(f => [f.id, f]));

  const { data: rps } = await supabase
    .from("round_players")
    .select("team_number")
    .eq("round_id", roundId)
    .gt("team_number", 0);
  const teamNumbers = [
    ...new Set(((rps ?? []) as { team_number: number }[]).map(r => r.team_number)),
  ];

  const { data: ft } = await supabase
    .from("flight_teams")
    .select("team_number, flight_id")
    .eq("round_id", roundId);
  const explicit = new Map<number, number>();
  ((ft ?? []) as { team_number: number; flight_id: number }[]).forEach(r =>
    explicit.set(r.team_number, r.flight_id),
  );

  for (const tn of teamNumbers) {
    const fid = explicit.get(tn);
    map.set(tn, (fid != null ? byId.get(fid) : undefined) ?? primary);
  }
  return map;
}

// Batch accessor: the PRIMARY flight for each of many rounds, as a
// Map<roundId, Flight>. Session-1 equivalence helper for the batch-stats
// surfaces (player profile, season, playerStats, leaderboard) that previously
// read rounds.format / format_config across many rounds in one query.
//
// Session 3 must revisit those callers for true multi-flight rounds: "primary
// flight" is well-defined only while every round has exactly one flight. With
// multiple flights per round they will need per-flight aggregation or a
// documented rollup decision (see ROADMAP Flights track).
//
// Mind Supabase's default 1000-row cap: this league has one flight per round
// and far fewer than 1000 rounds, so a single un-paginated `.in()` is complete.
export async function getPrimaryFlightByRound(
  roundIds: number[],
): Promise<Map<number, Flight>> {
  const result = new Map<number, Flight>();
  const unique = [...new Set(roundIds)];
  if (unique.length === 0) return result;

  const { data } = await supabase
    .from("flights")
    .select(FLIGHT_COLUMNS)
    .in("round_id", unique)
    .order("sort_order", { ascending: true });

  // Ascending sort means the first row seen per round is its primary flight.
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const flight = rowToFlight(row);
    if (!result.has(flight.round_id)) result.set(flight.round_id, flight);
  }
  return result;
}

// Batch (round_id, team_number) → Flight resolver across many rounds. The
// per-PLAYER stats surfaces (player profile, season, playerStats, playedWith)
// need each round_player's flight to gate stats inclusion / read the right
// allowance — the PRIMARY flight is wrong once a round has 2+ flights. This
// applies the SAME canonical default rule as getTeamFlightMap (explicit
// flight_teams row wins; otherwise the round's first flight), batched.
//
// Returns a resolver with a synchronous `get(roundId, teamNumber)`. Deliberately
// does NOT fetch round_players (the callers already have those, and a round-wide
// `.in()` over round_players could exceed Supabase's 1000-row cap): it resolves
// any team on demand from flights + flight_teams alone. Both of those are small
// (≈1–2 flights per round; flight_teams rows exist only for explicitly-moved
// teams), so the two `.in()` queries here stay well under the cap.
export type TeamFlightResolver = {
  get(roundId: number, teamNumber: number): Flight | null;
  // EFFECTIVE FormatConfig for a (round, team): the team's flight config with its
  // per-team allowance override folded in (via effectiveTeamConfig). Batch stats
  // readers (player profile, season, playerStats, playedWith) use this so
  // per-player PH/stats reflect an override. Null if the round has no flights.
  getConfig(roundId: number, teamNumber: number): FormatConfig | null;
};

export async function getTeamFlightsByRounds(
  roundIds: number[],
): Promise<TeamFlightResolver> {
  const unique = [...new Set(roundIds)];
  if (unique.length === 0) return { get: () => null, getConfig: () => null };

  const { data: flightRows } = await supabase
    .from("flights")
    .select(FLIGHT_COLUMNS)
    .in("round_id", unique)
    .order("sort_order", { ascending: true });

  // round_id → flights (sort_order ascending; [0] is the default-rule primary).
  const flightsByRound = new Map<number, Flight[]>();
  const flightById = new Map<number, Flight>();
  for (const row of (flightRows ?? []) as Record<string, unknown>[]) {
    const f = rowToFlight(row);
    if (!flightsByRound.has(f.round_id)) flightsByRound.set(f.round_id, []);
    flightsByRound.get(f.round_id)!.push(f);
    flightById.set(f.id, f);
  }

  const { data: ftRows } = await supabase
    .from("flight_teams")
    .select("round_id, team_number, flight_id, handicap_allowance")
    .in("round_id", unique);
  const explicit = new Map<string, number>();
  const overrideByTeam = new Map<string, number>();
  for (const r of (ftRows ?? []) as {
    round_id: number; team_number: number; flight_id: number; handicap_allowance: number | null;
  }[]) {
    explicit.set(`${r.round_id}:${r.team_number}`, r.flight_id);
    if (r.handicap_allowance != null) {
      overrideByTeam.set(`${r.round_id}:${r.team_number}`, r.handicap_allowance);
    }
  }

  function get(roundId: number, teamNumber: number): Flight | null {
    const flights = flightsByRound.get(roundId);
    if (!flights || flights.length === 0) return null;
    const fid = explicit.get(`${roundId}:${teamNumber}`);
    if (fid != null) {
      const f = flightById.get(fid);
      if (f && f.round_id === roundId) return f;
    }
    return flights[0]; // default rule: lowest sort_order
  }

  return {
    get,
    getConfig(roundId: number, teamNumber: number): FormatConfig | null {
      const flight = get(roundId, teamNumber);
      return effectiveTeamConfig(
        flight?.format_config ?? null,
        overrideByTeam.get(`${roundId}:${teamNumber}`) ?? null,
      );
    },
  };
}

// Idempotently ensure a round has its primary flight ("Flight A", sort_order 1,
// format null). Called at round creation (ensureRoundShell) so the invariant
// "every round has exactly one flight" — with NO format qualifier — holds for
// rounds created after migration 022, the same as the backfill guarantees for
// pre-022 rounds. The unique (round_id, sort_order) constraint makes this a
// no-op when the flight already exists (ignoreDuplicates). The shell config
// mirrors the round shell (DEFAULT_FORMAT_CONFIG_SHELL, no submitted_teams);
// the FormatPicker overwrites it the moment a format is chosen.
export async function ensurePrimaryFlight(roundId: number): Promise<void> {
  const { error } = await supabase.from("flights").upsert(
    {
      round_id: roundId,
      name: "Flight A",
      sort_order: 1,
      format: null,
      format_config: DEFAULT_FORMAT_CONFIG_SHELL,
    },
    { onConflict: "round_id,sort_order", ignoreDuplicates: true },
  );
  if (error) throw new Error("ensurePrimaryFlight: " + error.message);
}

// Thin field accessors so callers don't reach into a Flight inline. format and
// format_config feed the existing single-source helpers in lib/format/helpers
// (getScoringBasis, getOverrideHoles, getHandicapAllowance,
// getPlayingCourseHandicap, getTeamBallCount, isTeamCardFormat, …).
export function flightFormat(flight: Flight | null | undefined): Format | null {
  return flight?.format ?? null;
}

export function flightConfig(
  flight: Flight | null | undefined,
): FormatConfig | null {
  return flight?.format_config ?? null;
}

export function flightFormatLockedAt(
  flight: Flight | null | undefined,
): string | null {
  return flight?.format_locked_at ?? null;
}
