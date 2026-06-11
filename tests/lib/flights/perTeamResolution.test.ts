// Cross-surface agreement (Session 2): in a 2-flight round with DIFFERENT
// formats + allowances, each team's scoring surface resolves format/allowance
// from ITS flight (getFlightForTeam), and team-card-vs-individual routing
// follows the TEAM's flight format — not the round's primary flight.

import { describe, it, expect, beforeEach, vi } from "vitest";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() { return fakeRef.current; },
}));

import { FakeSupabase, type FakeData } from "../../components/fake-supabase";
import { getFlightForTeam } from "@/lib/flights/resolve";
import { getHandicapAllowance, isTeamCardFormat } from "@/lib/format/helpers";
import { scorecardHref } from "@/lib/round/scorecardHref";

// Round 1: Flight A = 2_ball @ 80% (individual); Flight B = texas_scramble
// (team-card, no allowance). Team 1 → A (default rule), Team 2 → B (explicit).
function seed(): FakeData {
  return {
    rounds: [{ id: 1, played_on: "2026-05-26", is_complete: false }],
    tees: [], holes: [], players: [], scores: [],
    round_players: [
      { id: 11, round_id: 1, player_id: 101, team_number: 1 },
      { id: 21, round_id: 1, player_id: 201, team_number: 2 },
    ],
    flights: [
      { id: 10, round_id: 1, name: "Flight A", sort_order: 1, format: "2_ball",
        format_config: { scoring_basis: "net", best_n: 2, handicap_allowance: 80 }, format_locked_at: null },
      { id: 20, round_id: 1, name: "Flight B", sort_order: 2, format: "texas_scramble",
        format_config: { scoring_basis: "net" }, format_locked_at: null },
    ],
    flight_teams: [
      { id: 1, flight_id: 20, round_id: 1, team_number: 2 },
    ],
  };
}

beforeEach(() => { fakeRef.current = new FakeSupabase(seed()); });

describe("per-team format + allowance resolution", () => {
  it("team 1 resolves to Flight A (2_ball, 80%), team 2 to Flight B (texas_scramble)", async () => {
    const fa = await getFlightForTeam(1, 1);
    const fb = await getFlightForTeam(1, 2);

    expect(fa?.format).toBe("2_ball");
    expect(getHandicapAllowance(fa?.format_config)).toBe(80);

    expect(fb?.format).toBe("texas_scramble");
    // Different flight ⇒ different format AND allowance source — no bleed.
    expect(fb?.format).not.toBe(fa?.format);
  });
});

describe("routing follows the TEAM's flight format (not the round's primary)", () => {
  it("team 1 → individual /scorecard, team 2 → /team-card", async () => {
    const fa = await getFlightForTeam(1, 1);
    const fb = await getFlightForTeam(1, 2);

    // The scorecard/RoundSetup links pass the team's flight format to scorecardHref.
    expect(scorecardHref(1, 1, fa?.format ?? null)).toBe("/round/1/scorecard?team=1");
    expect(scorecardHref(1, 2, fb?.format ?? null)).toBe("/round/1/team-card?team=2");

    // The routing decision equals isTeamCardFormat of the TEAM's flight format.
    expect(isTeamCardFormat(fa?.format)).toBe(false);
    expect(isTeamCardFormat(fb?.format)).toBe(true);
  });
});
