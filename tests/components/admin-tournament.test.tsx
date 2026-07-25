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
      await screen.findByText(/A league round already exists on 2026-08-01\. Delete it or pick another date\./),
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
});
