// @vitest-environment jsdom

// Flights Track, Session 3 — the Alternate Shot 2-player guard is scoped to the
// TARGET flight. A 3-man team in flight B must NOT block Alt-Shot on flight A,
// and Alt-Shot must stay blocked on flight B.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/useIsMobile", () => ({ useIsMobile: () => false }));

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() { return fakeRef.current; },
}));

import { FakeSupabase, type FakeData } from "../../components/fake-supabase";
import FormatPicker from "@/components/format/FormatPicker";

// Flight A (id 10): Team 1 + Team 2, each EXACTLY 2 players. Flight B (id 20):
// Team 3 with THREE players. Teams resolve via explicit flight_teams rows.
function seed(): FakeData {
  return {
    rounds: [{ id: 1, played_on: "2026-06-11", is_complete: false }],
    tees: [], holes: [], players: [], scores: [],
    round_players: [
      { id: 11, round_id: 1, player_id: 101, team_number: 1 },
      { id: 12, round_id: 1, player_id: 102, team_number: 1 },
      { id: 21, round_id: 1, player_id: 201, team_number: 2 },
      { id: 22, round_id: 1, player_id: 202, team_number: 2 },
      { id: 31, round_id: 1, player_id: 301, team_number: 3 },
      { id: 32, round_id: 1, player_id: 302, team_number: 3 },
      { id: 33, round_id: 1, player_id: 303, team_number: 3 },
    ],
    flights: [
      { id: 10, round_id: 1, name: "Flight A", sort_order: 1, format: "2_ball",
        format_config: { scoring_basis: "net", best_n: 2 }, format_locked_at: null },
      { id: 20, round_id: 1, name: "Flight B", sort_order: 2, format: "2_ball",
        format_config: { scoring_basis: "net", best_n: 2 }, format_locked_at: null },
    ],
    flight_teams: [
      { id: 1, flight_id: 10, round_id: 1, team_number: 1 },
      { id: 2, flight_id: 10, round_id: 1, team_number: 2 },
      { id: 3, flight_id: 20, round_id: 1, team_number: 3 },
    ],
  };
}

function altShotButton(): HTMLButtonElement {
  return screen.getByText("Alternate Shot").closest("button") as HTMLButtonElement;
}

beforeEach(() => { fakeRef.current = new FakeSupabase(seed()); });
afterEach(() => cleanup());

describe("FormatPicker — Alt-Shot guard is per-flight", () => {
  it("flight A (all 2-player teams) → Alternate Shot is selectable", async () => {
    render(
      <FormatPicker
        open roundId={1} flightId={10}
        currentFormat="2_ball" currentConfig={{ basis: "net", scoring_basis: "net", best_n: 2 }}
        formatLocked={false}
        onClose={() => {}} onSaved={() => {}}
      />,
    );
    // After the per-flight team-size load, flight A's teams are all 2 → enabled.
    await waitFor(() => expect(altShotButton()).not.toBeDisabled());
    expect(screen.queryByText(/Needs exactly 2 players on every team/)).not.toBeInTheDocument();
  });

  it("flight B (a 3-man team) → Alternate Shot stays blocked", async () => {
    render(
      <FormatPicker
        open roundId={1} flightId={20}
        currentFormat="2_ball" currentConfig={{ basis: "net", scoring_basis: "net", best_n: 2 }}
        formatLocked={false}
        onClose={() => {}} onSaved={() => {}}
      />,
    );
    // Flight B holds a 3-player team → the guard blocks Alt-Shot there. (Use a
    // settle wait so a late team-size load can't flip it open.)
    await waitFor(() => {
      expect(screen.getByText(/Needs exactly 2 players on every team/)).toBeInTheDocument();
    });
    expect(altShotButton()).toBeDisabled();
  });
});
