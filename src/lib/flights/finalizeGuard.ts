// SESSION-4-REMOVE
// ─────────────────────────────────────────────────────────────────────────────
// Temporary multi-flight finalize guard (Session 2). Flight-aware finalize +
// per-flight payouts ship in Session 4; until then a round with 2+ non-empty
// flights cannot be finalized (the finalize RPCs are still round-wide and would
// score every team under one flight's format). Every Submit Final Scores entry
// point (individual scorecard + team-card) consults this and blocks with a
// notice. DELETE THIS FILE and its callers when Session 4 lands flight-aware
// finalize. Search: SESSION-4-REMOVE.
// ─────────────────────────────────────────────────────────────────────────────
import { getTeamFlightMap } from "./resolve";

// True when the round has 2+ flights that each hold at least one (resolved)
// team. A round with one flight, or with extra empty flights, is NOT blocked.
export async function roundHasMultipleNonEmptyFlights(
  roundId: number,
): Promise<boolean> {
  const teamMap = await getTeamFlightMap(roundId);
  const nonEmptyFlightIds = new Set([...teamMap.values()].map(f => f.id));
  return nonEmptyFlightIds.size >= 2;
}

export const MULTI_FLIGHT_FINALIZE_NOTICE =
  "Multi-flight rounds can't be finalized yet — coming soon.";
