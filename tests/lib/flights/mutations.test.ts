// Flights write surface (Session 2) — CRUD validations + the shared team→flight
// resolver + the temporary finalize guard. Fixtures start in states where the
// code must do real work: a SECOND flight already present, a team explicitly
// mapped to the NON-primary flight, so a naive implementation fails.

import { describe, it, expect, beforeEach, vi } from "vitest";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() { return fakeRef.current; },
}));

import { FakeSupabase, type FakeData } from "../../components/fake-supabase";
import {
  createFlight,
  renameFlight,
  deleteFlight,
  moveTeamToFlight,
  flightLetter,
} from "@/lib/flights/mutations";
import { getTeamFlightMap } from "@/lib/flights/resolve";

// Round 1 with TWO flights (A sort 1, B sort 2). Three teams; team 3 is
// explicitly moved to flight B. Teams 1 & 2 have no flight_teams row → default
// rule → flight A. Flights seeded in REVERSE so nothing leans on array order.
function seed(): FakeData {
  return {
    rounds: [{ id: 1, played_on: "2026-05-26", is_complete: false }],
    tees: [], holes: [], players: [], scores: [],
    round_players: [
      { id: 11, round_id: 1, player_id: 101, team_number: 1 },
      { id: 12, round_id: 1, player_id: 102, team_number: 1 },
      { id: 21, round_id: 1, player_id: 201, team_number: 2 },
      { id: 31, round_id: 1, player_id: 301, team_number: 3 },
    ],
    flights: [
      { id: 20, round_id: 1, name: "Flight B", sort_order: 2, format: "shambles", format_config: { scoring_basis: "net" }, format_locked_at: null },
      { id: 10, round_id: 1, name: "Flight A", sort_order: 1, format: "2_ball", format_config: { scoring_basis: "net" }, format_locked_at: null },
    ],
    flight_teams: [
      { id: 1, flight_id: 20, round_id: 1, team_number: 3 },
    ],
  };
}

beforeEach(() => { fakeRef.current = new FakeSupabase(seed()); });

describe("flightLetter", () => {
  it("maps sort position to a spreadsheet-style letter", () => {
    expect(flightLetter(1)).toBe("A");
    expect(flightLetter(2)).toBe("B");
    expect(flightLetter(26)).toBe("Z");
    expect(flightLetter(27)).toBe("AA");
  });
});

describe("getTeamFlightMap — default rule + explicit wins", () => {
  it("unmapped teams resolve to the FIRST flight; an explicit row wins", async () => {
    const map = await getTeamFlightMap(1);
    expect(map.get(1)?.name).toBe("Flight A"); // default rule
    expect(map.get(2)?.name).toBe("Flight A"); // default rule
    expect(map.get(3)?.name).toBe("Flight B"); // explicit flight_teams row
    expect(map.get(3)?.format).toBe("shambles");
  });
});

describe("createFlight", () => {
  it("appends with sort_order = max+1 and the next letter name", async () => {
    const f = await createFlight(1);
    expect(f.sort_order).toBe(3);
    expect(f.name).toBe("Flight C");
    expect(f.format).toBeNull();
  });
});

describe("renameFlight", () => {
  it("rejects a blank name", async () => {
    await expect(renameFlight(10, "   ")).rejects.toThrow(/blank/);
  });
  it("trims and saves a valid name", async () => {
    await renameFlight(20, "  4-Man  ");
    const map = await getTeamFlightMap(1);
    expect(map.get(3)?.name).toBe("4-Man");
  });
});

describe("moveTeamToFlight", () => {
  it("moves a team and re-moving updates in place (upsert on round_id+team_number)", async () => {
    await moveTeamToFlight(1, 1, 20); // team 1 → flight B
    let map = await getTeamFlightMap(1);
    expect(map.get(1)?.name).toBe("Flight B");

    await moveTeamToFlight(1, 1, 10); // move back to A
    map = await getTeamFlightMap(1);
    expect(map.get(1)?.name).toBe("Flight A");
    // No duplicate flight_teams rows for (round 1, team 1).
    const ft = (fakeRef.current.data.flight_teams as any[]).filter(r => r.round_id === 1 && r.team_number === 1);
    expect(ft.length).toBe(1);
  });

  it("moving to the FIRST flight writes an explicit row (not implicit)", async () => {
    await moveTeamToFlight(1, 2, 10); // team 2 → flight A explicitly
    const ft = (fakeRef.current.data.flight_teams as any[]).filter(r => r.team_number === 2);
    expect(ft.length).toBe(1);
    expect(ft[0].flight_id).toBe(10);
  });
});

describe("deleteFlight — validations", () => {
  it("rejects deleting the round's only flight", async () => {
    fakeRef.current = new FakeSupabase({
      rounds: [{ id: 9, played_on: "2026-05-26", is_complete: false }],
      tees: [], holes: [], players: [], scores: [],
      round_players: [{ id: 1, round_id: 9, player_id: 1, team_number: 1 }],
      flights: [{ id: 90, round_id: 9, name: "Flight A", sort_order: 1, format: "2_ball", format_config: {}, format_locked_at: null }],
      flight_teams: [],
    });
    await expect(deleteFlight(90)).rejects.toThrow(/only flight/);
  });

  it("rejects deleting the FIRST flight while it holds implicit (default-rule) teams", async () => {
    // Flight A holds teams 1 & 2 implicitly (no flight_teams rows) → blocked.
    await expect(deleteFlight(10)).rejects.toThrow(/move its teams/);
  });

  it("rejects deleting a non-first flight that holds an explicit team", async () => {
    // Flight B holds team 3 (explicit row) → blocked.
    await expect(deleteFlight(20)).rejects.toThrow(/move its teams/);
  });

  it("deletes a non-first EMPTY flight", async () => {
    const empty = await createFlight(1); // Flight C, sort 3, no teams
    await deleteFlight(empty.id);
    const map = await getTeamFlightMap(1);
    expect([...map.values()].some(f => f.id === empty.id)).toBe(false);
    expect((fakeRef.current.data.flights as any[]).some(f => f.id === empty.id)).toBe(false);
  });
});

// NOTE: the Session-2 `roundHasMultipleNonEmptyFlights` finalize GUARD (and its
// tests) were removed in Session 4 when flight-aware finalize shipped
// (finalize_round_flights). Multi-flight detection now lives inline in the
// finalize surfaces as a ROUTING predicate, not a block.
