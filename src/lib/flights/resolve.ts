import { supabase } from "@/lib/supabase";
import type { Format, FormatConfig } from "@/lib/scoring/types";
import { DEFAULT_FORMAT_CONFIG_SHELL } from "@/lib/format/copy";

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

const FLIGHT_COLUMNS =
  "id, round_id, name, sort_order, format, format_config, format_locked_at";

function rowToFlight(row: Record<string, unknown>): Flight {
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
