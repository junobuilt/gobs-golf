import { supabase } from "@/lib/supabase";
import { DEFAULT_FORMAT_CONFIG_SHELL } from "@/lib/format/copy";
import {
  FLIGHT_COLUMNS,
  rowToFlight,
  getFlightsForRound,
  getFlightForTeam,
  getTeamFlightMap,
  type Flight,
} from "./resolve";

// ─────────────────────────────────────────────────────────────────────────────
// Flights — write surface (Session 2). Admin CRUD over flights / flight_teams.
//
// These are the ONLY writers of flight_teams, and (alongside FormatPicker +
// RoundSetup allowance + ensureRoundShell) of flights. They NEVER touch
// rounds.format* — format ownership lives on the flight (see resolve.ts header).
// resolve.ts stays read-only; all mutation lives here.
// ─────────────────────────────────────────────────────────────────────────────

// Auto-name a flight from its sort position: 1 → "Flight A", 2 → "Flight B", …
// 26 → "Flight Z", 27 → "Flight AA" (spreadsheet-column style; >26 is never hit
// in practice but handled so the name is always defined). The name is stored as
// plain text and freely renamed afterward — this is only the creation default.
export function flightLetter(sortOrder: number): string {
  let n = Math.max(1, Math.floor(sortOrder));
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Create a new (empty, format-null) flight for a round. sort_order = max+1 so it
// always lands after the existing flights; name defaults to its letter. Holds
// no teams — the admin moves teams into it via moveTeamToFlight.
export async function createFlight(roundId: number): Promise<Flight> {
  const flights = await getFlightsForRound(roundId);
  const nextSort = flights.reduce((m, f) => Math.max(m, f.sort_order), 0) + 1;
  const { data, error } = await supabase
    .from("flights")
    .insert({
      round_id: roundId,
      name: `Flight ${flightLetter(nextSort)}`,
      sort_order: nextSort,
      format: null,
      format_config: DEFAULT_FORMAT_CONFIG_SHELL,
    })
    .select(FLIGHT_COLUMNS)
    .single();
  if (error || !data) {
    throw new Error("createFlight: " + (error?.message ?? "no row returned"));
  }
  return rowToFlight(data as Record<string, unknown>);
}

// Cosmetic rename. Non-blank validation only (trimmed). Never changes format,
// teams, or sort order.
export async function renameFlight(flightId: number, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("renameFlight: name cannot be blank");
  const { error } = await supabase
    .from("flights")
    .update({ name: trimmed })
    .eq("id", flightId);
  if (error) throw new Error("renameFlight: " + error.message);
}

// Delete a flight. REJECTED unless BOTH:
//   1. it is not the round's only flight, AND
//   2. no team RESOLVES to it — neither an explicit flight_teams row nor (for
//      the first flight) an implicit default-rule team.
// getTeamFlightMap applies the same default rule the rest of the app uses, so a
// first flight still holding implicit teams is correctly blocked. flight_teams
// rows pointing here would cascade-delete, but by rule there are none.
export async function deleteFlight(flightId: number): Promise<void> {
  const { data: row } = await supabase
    .from("flights")
    .select("id, round_id")
    .eq("id", flightId)
    .maybeSingle();
  if (!row) throw new Error("deleteFlight: flight not found");
  const roundId = (row as { round_id: number }).round_id;

  const flights = await getFlightsForRound(roundId);
  if (flights.length <= 1) {
    throw new Error("deleteFlight: cannot delete the round's only flight");
  }

  const teamMap = await getTeamFlightMap(roundId);
  const holdsTeams = [...teamMap.values()].some(f => f.id === flightId);
  if (holdsTeams) {
    throw new Error("deleteFlight: move its teams to another flight first");
  }

  const { error } = await supabase.from("flights").delete().eq("id", flightId);
  if (error) throw new Error("deleteFlight: " + error.message);
}

// Assign a team to a flight. Upserts the (round_id, team_number) → flight_id
// mapping (unique on round_id+team_number, so re-moving updates in place).
// Writes an EXPLICIT row even when moving to the first flight — simpler than
// deleting back to implicit, and the default rule in resolve.ts still covers
// teams that were never moved.
export async function moveTeamToFlight(
  roundId: number,
  teamNumber: number,
  flightId: number,
): Promise<void> {
  const { error } = await supabase
    .from("flight_teams")
    .upsert(
      { round_id: roundId, team_number: teamNumber, flight_id: flightId },
      { onConflict: "round_id,team_number" },
    );
  if (error) throw new Error("moveTeamToFlight: " + error.message);
}

// Set (or clear) a team's per-team handicap-allowance OVERRIDE. `allowance` is a
// percentage (10–100) to override, or null to revert to inheriting the flight
// default. Materializes a flight_teams row for default-rule teams (those without
// one) by assigning them to their RESOLVED flight — the canonical default, so no
// flight reassignment happens for an already-explicit team (getFlightForTeam
// returns its current flight). The upsert preserves flight_id and only sets the
// allowance. THE override-resolution rule lives in resolve.ts (effectiveTeamConfig);
// this only writes the stored value.
export async function setTeamAllowance(
  roundId: number,
  teamNumber: number,
  allowance: number | null,
): Promise<void> {
  const flight = await getFlightForTeam(roundId, teamNumber);
  if (!flight) throw new Error("setTeamAllowance: round has no flights");
  const { error } = await supabase
    .from("flight_teams")
    .upsert(
      {
        round_id: roundId,
        team_number: teamNumber,
        flight_id: flight.id,
        handicap_allowance: allowance,
      },
      { onConflict: "round_id,team_number" },
    );
  if (error) throw new Error("setTeamAllowance: " + error.message);
}
