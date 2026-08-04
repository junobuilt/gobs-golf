// @vitest-environment jsdom
//
// S2 Change 3 — Day-1 (greensomes) hole correction in the "Results & overrides"
// panel. Day 1 plays one ball per side, so the panel corrects the SIDE's team
// score (team_scores), not a player's — the parity with Day 2/3's per-player
// "Correct a hole". Asserts: the greensomes control renders (not the old static
// note), the strokes input PREFILLS the current team score, and Save writes the
// corrected value through the SAME team_scores upsert live Day-1 entry uses.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { FakeData } from "./fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));

import { FakeSupabase } from "./fake-supabase";
import MatchOverridePanel from "@/app/admin/components/MatchOverridePanel";
import type { Tournament, TournamentSession } from "@/lib/tournament/types";

const TOURN: Tournament = { id: 1, name: "Cup", season_id: null, side_a_name: "USA", side_b_name: "Canada", holder_side: "b", started_on: "2026-08-01", ended_on: null, is_active: true, is_published: false, planned_match_total: null, notes: null };
const SESSION: TournamentSession = { id: 8, tournament_id: 1, round_id: 60, day_number: 1, name: "Day 1 — Alternate Shot", format: "greensomes", played_on: "2026-08-01", is_locked: false };

const holes = (teeId: number) => Array.from({ length: 18 }, (_, i) => ({ id: teeId * 100 + i, tee_id: teeId, hole_number: i + 1, par: 4, stroke_index: i + 1, yardage: 350 }));
function teamAll(teamNumber: number, g: number, startId: number) {
  return Array.from({ length: 18 }, (_, i) => ({ id: startId + i, round_id: 60, team_number: teamNumber, hole_number: i + 1, ball_index: 1, strokes: g }));
}

// One greensomes match: team 1 (Al/Bo) v team 2 (Cy/Di). Team 1's hole 1 is a 5.
function seed(): FakeData {
  return {
    rounds: [{ id: 60, played_on: "2026-08-01", course_id: 1, tournament_id: 1, season_id: null }],
    tees: [{ id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 }],
    holes: holes(1),
    players: [
      { id: 1, full_name: "Al Apple", display_name: "Al", handicap_index: 0, is_active: true },
      { id: 2, full_name: "Bo Birch", display_name: "Bo", handicap_index: 0, is_active: true },
      { id: 3, full_name: "Cy Cedar", display_name: "Cy", handicap_index: 0, is_active: true },
      { id: 4, full_name: "Di Dune", display_name: "Di", handicap_index: 0, is_active: true },
    ],
    round_players: [
      { id: 201, round_id: 60, player_id: 1, team_number: 1, tee_id: 1, course_handicap: 0, handicap_index_snapshot: 0 },
      { id: 202, round_id: 60, player_id: 2, team_number: 1, tee_id: 1, course_handicap: 0, handicap_index_snapshot: 0 },
      { id: 203, round_id: 60, player_id: 3, team_number: 2, tee_id: 1, course_handicap: 0, handicap_index_snapshot: 0 },
      { id: 204, round_id: 60, player_id: 4, team_number: 2, tee_id: 1, course_handicap: 0, handicap_index_snapshot: 0 },
    ],
    scores: [],
    // Team 1 hole 1 = 5 (the value that must prefill); the rest 4.
    team_scores: [
      { id: 3000, round_id: 60, team_number: 1, hole_number: 1, ball_index: 1, strokes: 5 },
      ...teamAll(1, 4, 3001).slice(1),
      ...teamAll(2, 4, 4000),
    ],
    tournaments: [TOURN],
    tournament_players: [],
    tournament_sessions: [SESSION],
    tournament_matches: [{ id: 600, tournament_id: 1, session_id: 8, match_number: 1, group_number: 1, side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, flagged_holes: [], admin_note: null }],
    tournament_point_adjustments: [],
  };
}

beforeEach(() => {
  fakeRef.current = new FakeSupabase(seed());
});
afterEach(() => cleanup());

describe("Greensomes (Day 1) hole correction in Results & overrides", () => {
  it("renders the team-score correction control (not the old static note) and prefills the current team score", async () => {
    render(<MatchOverridePanel session={SESSION} tournament={TOURN} onClose={() => {}} />);

    // The greensomes control renders (side/hole/strokes) — the deferred-to-scorecard note is gone.
    const strokes = (await screen.findByTestId("gs-hole-strokes-600")) as HTMLInputElement;
    expect(screen.getByTestId("gs-hole-team-600")).toBeTruthy();
    expect(screen.queryByText(/correct a wrong greensomes hole on the scorecard/i)).toBeNull();

    // Team 1 (side A) + hole 1 default → prefilled with the stored 5.
    await waitFor(() => expect(strokes.value).toBe("5"));
  });

  it("Save writes the corrected team score through the team_scores upsert (ball_index 1, 4-col key)", async () => {
    render(<MatchOverridePanel session={SESSION} tournament={TOURN} onClose={() => {}} />);
    const strokes = (await screen.findByTestId("gs-hole-strokes-600")) as HTMLInputElement;

    fireEvent.change(strokes, { target: { value: "7" } });
    fireEvent.click(screen.getByTestId("gs-hole-save-600"));

    await waitFor(() => {
      const w = fakeRef.current.writes.find((x: any) => x.table === "team_scores" && x.type === "upsert");
      expect(w).toBeTruthy();
      expect(w.onConflict).toEqual(["round_id", "team_number", "hole_number", "ball_index"]);
      expect(w.payload[0]).toMatchObject({ round_id: 60, team_number: 1, hole_number: 1, ball_index: 1, strokes: 7 });
    });
  });
});
