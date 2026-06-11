// Flights resolution helper (Session 1) — the single source of truth for
// format ownership and the CANONICAL DEFAULT RULE: a team with no flight_teams
// row belongs to the round's FIRST flight (lowest sort_order).
//
// Anti-confirmation-bias: every fixture starts in a state where the code must
// do real work. Flights are seeded in the WRONG array order (Flight B first),
// and a second flight is present with a team explicitly mapped to it — so a
// helper that naively returned "the first row" or "Flight A always" would FAIL.

import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() { return fakeRef.current; },
}));

import { FakeSupabase, type FakeData } from "../../components/fake-supabase";
import {
  getFlightsForRound,
  getPrimaryFlightForRound,
  getFlightForTeam,
  getPrimaryFlightByRound,
} from "@/lib/flights/resolve";

// A round (id 1) with TWO flights, seeded in reverse sort order so ordering is
// load-bearing. Team 2 is explicitly mapped to Flight B; team 1 has no mapping
// (default rule → Flight A). Round 2 has a single flight to exercise the batch.
function seed(): FakeData {
  return {
    rounds: [
      { id: 1, played_on: "2026-05-26", is_complete: false },
      { id: 2, played_on: "2026-05-25", is_complete: true },
    ],
    tees: [],
    holes: [],
    round_players: [],
    players: [],
    scores: [],
    flights: [
      // Deliberately OUT of sort_order so getFlightsForRound must sort.
      { id: 20, round_id: 1, name: "Flight B", sort_order: 2, format: "gobs_stableford", format_config: { scoring_basis: "net" }, format_locked_at: null },
      { id: 10, round_id: 1, name: "Flight A", sort_order: 1, format: "2_ball", format_config: { scoring_basis: "net", best_n: 2 }, format_locked_at: null },
      { id: 30, round_id: 2, name: "Flight A", sort_order: 1, format: "best_ball", format_config: { scoring_basis: "net", best_n: 1 }, format_locked_at: null },
    ],
    flight_teams: [
      // Team 2 in round 1 is explicitly in Flight B (the non-primary flight).
      { id: 1, flight_id: 20, round_id: 1, team_number: 2 },
    ],
  };
}

beforeEach(() => { fakeRef.current = new FakeSupabase(seed()); });

describe("getFlightsForRound", () => {
  it("returns flights ordered by sort_order (fixture seeded reversed)", async () => {
    const flights = await getFlightsForRound(1);
    expect(flights.map(f => f.name)).toEqual(["Flight A", "Flight B"]);
    expect(flights.map(f => f.sort_order)).toEqual([1, 2]);
  });
});

describe("getPrimaryFlightForRound", () => {
  it("returns the lowest-sort_order flight, NOT the first-seeded row", async () => {
    const flight = await getPrimaryFlightForRound(1);
    expect(flight?.name).toBe("Flight A");
    expect(flight?.format).toBe("2_ball"); // would be gobs_stableford if it returned the seeded-first row
  });
});

describe("getFlightForTeam — canonical default rule", () => {
  it("team with NO flight_teams row → the round's first flight (default rule)", async () => {
    const flight = await getFlightForTeam(1, 1);
    expect(flight?.name).toBe("Flight A");
    expect(flight?.format).toBe("2_ball");
  });

  it("team WITH an explicit flight_teams row → that flight, NOT Flight A", async () => {
    const flight = await getFlightForTeam(1, 2);
    expect(flight?.name).toBe("Flight B");
    // The load-bearing assertion: the explicit mapping wins over the default.
    expect(flight?.format).toBe("gobs_stableford");
    expect(flight?.format).not.toBe("2_ball");
  });

  it("returns null when the round has no flights at all", async () => {
    const flight = await getFlightForTeam(999, 1);
    expect(flight).toBeNull();
  });
});

describe("getPrimaryFlightByRound — batch", () => {
  it("maps each round to its primary flight (round 1 → Flight A's 2_ball)", async () => {
    const map = await getPrimaryFlightByRound([1, 2]);
    expect(map.get(1)?.format).toBe("2_ball");
    expect(map.get(2)?.format).toBe("best_ball");
    // Flight B must NOT be chosen for round 1 even though it sorts/seeds around it.
    expect(map.get(1)?.name).toBe("Flight A");
  });

  it("dedupes round ids and ignores unknown rounds", async () => {
    const map = await getPrimaryFlightByRound([1, 1, 1, 777]);
    expect(map.size).toBe(1);
    expect(map.has(777)).toBe(false);
  });
});
