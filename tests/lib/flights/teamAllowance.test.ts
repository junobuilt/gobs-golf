// Per-team handicap allowance OVERRIDE — resolver layer.
//
// The rule (effectiveTeamConfig) is pure; the accessors (getTeamConfig,
// getTeamAllowanceOverrides, getTeamFlightsByRounds().getConfig) read the
// per-team override off flight_teams.handicap_allowance and fold it over the
// flight default. Wrong-state fixtures: a SECOND team is overridden to a
// DIFFERENT value so a naive "always the flight allowance" impl fails.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FakeData } from "../../components/fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() { return fakeRef.current; },
}));

import { FakeSupabase } from "../../components/fake-supabase";
import { effectiveTeamConfig } from "@/lib/format/helpers";
import {
  getTeamConfig,
  getTeamAllowanceOverrides,
  getTeamFlightsByRounds,
} from "@/lib/flights/resolve";
import { getHandicapAllowance } from "@/lib/format/helpers";

// One flight (allowance 80). Team 1 overridden to 50, Team 2 to 95, Team 3 has
// NO flight_teams row (default-rule team → inherits the flight's 80).
function seed(): FakeData {
  return {
    rounds: [{ id: 1, played_on: "2026-06-11", course_id: 1, is_complete: false, created_at: "2026-06-11T00:00:00Z" }],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes: [],
    players: [
      { id: 201, full_name: "A", display_name: "A", handicap_index: 0, preferred_tee_id: 1, is_active: true },
    ],
    // Team 3 needs a roster row so getTeamFlightMap-style resolution sees it, but
    // these resolver fns read flight_teams directly, so a single player suffices.
    round_players: [
      { id: 101, round_id: 1, player_id: 201, tee_id: 1, team_number: 3, course_handicap: 0, dropped_after_hole: null },
    ],
    scores: [],
    flights: [
      { id: 10, round_id: 1, name: "Flight A", sort_order: 1, format: "2_ball",
        format_config: { scoring_basis: "net", best_n: 2, handicap_allowance: 80 }, format_locked_at: null },
    ],
    flight_teams: [
      { id: 1, flight_id: 10, round_id: 1, team_number: 1, handicap_allowance: 50 },
      { id: 2, flight_id: 10, round_id: 1, team_number: 2, handicap_allowance: 95 },
      // Team 3: no row → default-rule team, no override.
    ],
  };
}

beforeEach(() => { fakeRef.current = new FakeSupabase(seed()); });

describe("effectiveTeamConfig (the pure rule)", () => {
  const flightCfg = { scoring_basis: "net", best_n: 2, handicap_allowance: 80 } as any;

  it("returns the flight config UNCHANGED when no override (null/undefined)", () => {
    expect(effectiveTeamConfig(flightCfg, null)).toBe(flightCfg);
    expect(effectiveTeamConfig(flightCfg, undefined)).toBe(flightCfg);
  });

  it("substitutes ONLY handicap_allowance when an override is present", () => {
    const eff = effectiveTeamConfig(flightCfg, 50);
    expect(getHandicapAllowance(eff)).toBe(50);
    // other keys preserved
    expect((eff as any).best_n).toBe(2);
    expect((eff as any).scoring_basis).toBe("net");
    // original is not mutated
    expect(getHandicapAllowance(flightCfg)).toBe(80);
  });

  it("handles a null flight config (override still applies)", () => {
    expect(getHandicapAllowance(effectiveTeamConfig(null, 60))).toBe(60);
  });
});

describe("getTeamConfig / getTeamAllowanceOverrides (single-team + round-wide)", () => {
  it("resolves each team's EFFECTIVE allowance: override beats flight default", async () => {
    const t1 = await getTeamConfig(1, 1);
    const t2 = await getTeamConfig(1, 2);
    const t3 = await getTeamConfig(1, 3);
    expect(getHandicapAllowance(t1.config)).toBe(50); // overridden
    expect(getHandicapAllowance(t2.config)).toBe(95); // overridden (different value)
    expect(getHandicapAllowance(t3.config)).toBe(80); // no row → flight default
    expect(t1.allowanceOverride).toBe(50);
    expect(t3.allowanceOverride).toBeNull();
  });

  it("getTeamAllowanceOverrides returns ONLY overridden teams", async () => {
    const map = await getTeamAllowanceOverrides(1);
    expect(map.get(1)).toBe(50);
    expect(map.get(2)).toBe(95);
    expect(map.has(3)).toBe(false); // default-rule team absent
  });
});

describe("getTeamFlightsByRounds().getConfig (batch readers)", () => {
  it("folds the override into each team's effective config", async () => {
    const resolver = await getTeamFlightsByRounds([1]);
    expect(getHandicapAllowance(resolver.getConfig(1, 1))).toBe(50);
    expect(getHandicapAllowance(resolver.getConfig(1, 2))).toBe(95);
    expect(getHandicapAllowance(resolver.getConfig(1, 3))).toBe(80); // default
  });
});
