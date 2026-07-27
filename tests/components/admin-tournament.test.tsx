// @vitest-environment jsdom
//
// Admin Tournament tab — side assignment writes the right row, uneven sides
// warn (never block), and LeagueRoundOwnsDateError renders friendly copy.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import type { FakeData } from "./fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));
// Keep the real addDaysISO / formatDisplayDate; only pin "today"/"yesterday".
vi.mock("@/lib/date", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/date")>();
  return { ...actual, todayLocal: () => "2026-08-01", yesterdayLocal: () => "2026-07-31" };
});

import { FakeSupabase } from "./fake-supabase";
import Tournament from "@/app/admin/tabs/Tournament";
import type { Player } from "@/app/admin/page";

const PLAYERS: Player[] = [
  { id: 1, full_name: "Al A", display_name: "Al", handicap_index: 8, is_active: true, preferred_tee_id: null },
  { id: 2, full_name: "Bo B", display_name: "Bo", handicap_index: 14, is_active: true, preferred_tee_id: null },
];

function seed(rounds: any[] = []): FakeData {
  return {
    rounds,
    tees: [],
    holes: [],
    round_players: [],
    players: PLAYERS.map((p) => ({ id: p.id, full_name: p.full_name, display_name: p.display_name, handicap_index: p.handicap_index, is_active: p.is_active })),
    scores: [],
    tournaments: [
      { id: 10, name: "2026 Cup", is_active: true, started_on: "2026-08-01", side_a_name: "USA", side_b_name: "Canada", holder_side: "b", season_id: null, ended_on: null, notes: null },
    ],
    tournament_players: [],
    tournament_sessions: [],
  };
}

describe("admin Tournament tab", () => {
  beforeEach(() => {
    fakeRef.current = new FakeSupabase(seed());
  });
  afterEach(() => cleanup());

  it("assigning a side writes the tournament_players row and warns on uneven sides", async () => {
    render(<Tournament allPlayers={PLAYERS} />);
    // Loads the active tournament.
    await screen.findByText("2026 Cup");
    expect(screen.getByText(/USA 0 · Canada 0 · Unassigned 2/)).toBeTruthy();

    // Assign player 1 (Al) to USA — click the USA button in Al's row.
    const alRow = screen.getByText("Al").closest("div")!.parentElement as HTMLElement;
    fireEvent.click(within(alRow).getByRole("button", { name: "USA" }));

    await waitFor(() => {
      const rows = fakeRef.current.data.tournament_players as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ tournament_id: 10, player_id: 1, side: "a" });
    });

    // Sides are now uneven (1 vs 0) → amber caption, but nothing is blocked.
    expect(await screen.findByText(/Sides are uneven/)).toBeTruthy();
    expect(screen.getByText(/USA 1 · Canada 0 · Unassigned 1/)).toBeTruthy();
  });

  it("adding a day on a league-owned date shows the friendly LeagueRoundOwnsDateError copy", async () => {
    // A league round already owns 2026-08-01 (the Add-Day default date).
    fakeRef.current = new FakeSupabase(
      seed([{ id: 900, played_on: "2026-08-01", course_id: 1, is_complete: true, tournament_id: null, season_id: 2, format: "2_ball" }]),
    );
    fakeRef.current.setOptions({
      failWrite: (op: any) => (op.table === "rounds" ? { code: "23505", message: "dup" } : false),
    });

    render(<Tournament allPlayers={PLAYERS} />);
    await screen.findByText("2026 Cup");

    fireEvent.click(screen.getByRole("button", { name: "+ Add Day" }));
    // Modal is open; click Add (date defaults to 2026-08-01).
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));

    expect(
      await screen.findByText(/A league round already exists on Sat, Aug 1, 2026\. Delete it or pick another date\./),
    ).toBeTruthy();
  });

  // §1 — a mutation that rejects must never leave the screen unchanged.
  it("a failed side assignment surfaces a visible error banner", async () => {
    fakeRef.current.setOptions({
      failWrite: (op: any) => (op.table === "tournament_players" ? { message: "boom" } : false),
    });

    render(<Tournament allPlayers={PLAYERS} />);
    await screen.findByText("2026 Cup");

    const alRow = screen.getByText("Al").closest("div")!.parentElement as HTMLElement;
    fireEvent.click(within(alRow).getByRole("button", { name: "USA" }));

    expect(await screen.findByText(/Couldn't save that side assignment/)).toBeTruthy();
  });

  // §4 — a session whose round is missing must be visibly flagged.
  it("a day with no round shows the amber 'No round' warning", async () => {
    fakeRef.current = new FakeSupabase({
      ...seed(),
      tournament_sessions: [
        { id: 5, tournament_id: 10, round_id: null, day_number: 1, name: "Day 1 — Greensomes", format: "greensomes", played_on: "2026-08-01", is_locked: false },
      ],
    });

    render(<Tournament allPlayers={PLAYERS} />);
    await screen.findByText("Day 1 — Greensomes");
    expect(screen.getByText(/No round — cannot hold scores/)).toBeTruthy();
  });

  // §3 (2.2c) — one day's pairings loader throwing must not take down the tab.
  it("isolates a day whose pairings fail to load; other days still render", async () => {
    const holes = (teeId: number) => Array.from({ length: 18 }, (_, i) => ({ id: teeId * 100 + i, tee_id: teeId, hole_number: i + 1, par: 4, stroke_index: i + 1 }));
    fakeRef.current = new FakeSupabase({
      ...seed(),
      tees: [
        { id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 },
        { id: 2, color: "Blue", slope_rating: 113, course_rating: 72, par: 72, sort_order: 2 },
      ],
      holes: [...holes(1), ...holes(2)],
      players: [
        { id: 1, full_name: "Al A", display_name: "Al", handicap_index: 8, is_active: true },
        { id: 2, full_name: "Bo B", display_name: "Bo", handicap_index: 14, is_active: true },
        { id: 3, full_name: "Cy C", display_name: "Cy", handicap_index: 10, is_active: true },
        { id: 4, full_name: "Di D", display_name: "Di", handicap_index: 12, is_active: true },
      ],
      round_players: [
        // Day 1 group — MIXED TEES ⇒ loadSessionMatches(21) throws.
        { id: 101, round_id: 50, player_id: 1, team_number: 1, tee_id: 1, course_handicap: 8, handicap_index_snapshot: 8 },
        { id: 102, round_id: 50, player_id: 2, team_number: 2, tee_id: 2, course_handicap: 14, handicap_index_snapshot: 14 },
        // Day 2 group — clean.
        { id: 103, round_id: 51, player_id: 3, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
        { id: 104, round_id: 51, player_id: 4, team_number: 2, tee_id: 1, course_handicap: 12, handicap_index_snapshot: 12 },
      ],
      tournament_players: [
        { id: 1, tournament_id: 10, player_id: 1, side: "a" },
        { id: 2, tournament_id: 10, player_id: 2, side: "b" },
        { id: 3, tournament_id: 10, player_id: 3, side: "a" },
        { id: 4, tournament_id: 10, player_id: 4, side: "b" },
      ],
      tournament_sessions: [
        { id: 21, tournament_id: 10, round_id: 50, day_number: 1, name: "Day 1 — Alternate Shot", format: "greensomes", played_on: "2026-08-01", is_locked: false },
        { id: 22, tournament_id: 10, round_id: 51, day_number: 2, name: "Day 2 — Best Ball", format: "four_ball_match", played_on: "2026-08-02", is_locked: false },
      ],
      tournament_matches: [
        { id: 500, tournament_id: 10, session_id: 21, match_number: 1, group_number: 1, side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, admin_note: null },
        { id: 501, tournament_id: 10, session_id: 22, match_number: 1, group_number: 1, side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, admin_note: null },
      ],
    } as FakeData);

    render(<Tournament allPlayers={PLAYERS} />);
    // Day 1's pairings failed → isolated note; Day 2 rendered its summary.
    expect(await screen.findByText(/Couldn’t load pairings — check this day’s groups/)).toBeTruthy();
    expect(screen.getByText(/1 group · 2 players/)).toBeTruthy();
    // The tab is still usable — the Sides section rendered.
    expect(screen.getByText(/Unassigned/)).toBeTruthy();
  });
});
