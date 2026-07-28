// @vitest-environment jsdom
// Public /tournament landing — lists all days + pairings for a LIVE (published)
// tournament; empty state when none is published (incl. a Test-only tournament).
// Loaders mocked; matches built from the shared fixture.

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { makeLoaded } from "../support/matchFixture";
import type { Tournament, TournamentSession } from "@/lib/tournament/types";

const mocks = vi.hoisted(() => ({
  getActiveTournament: vi.fn(),
  getTournamentSessions: vi.fn(),
  getTournamentPlayers: vi.fn(),
  loadSessionMatches: vi.fn(),
  // Full-league-roster players returned by the inline supabase read.
  players: [] as Array<{ id: number; full_name: string; display_name: string | null; is_active: boolean }>,
}));

vi.mock("@/lib/tournament/queries", () => ({
  getActiveTournament: mocks.getActiveTournament,
  getTournamentSessions: mocks.getTournamentSessions,
  getTournamentPlayers: mocks.getTournamentPlayers,
}));
vi.mock("@/lib/tournament/loadMatch", () => ({
  loadSessionMatches: mocks.loadSessionMatches,
}));
// Only the landing's inline `players` read hits supabase (loaders are mocked
// above). The chain resolves at `.order(...)` with the seeded roster.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => Promise.resolve({ data: mocks.players, error: null }),
      };
      return chain;
    },
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => React.createElement("a", { href, ...rest }, children),
}));
// Pin "today" to July — a future-dated (August) tournament → no day is "Today".
vi.mock("@/lib/date", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/date")>();
  return { ...actual, todayLocal: () => "2026-07-15" };
});

import TournamentLandingPage from "@/app/tournament/page";

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 1,
    name: "2026 GOBS Ryder Cup",
    season_id: null,
    side_a_name: "USA",
    side_b_name: "Canada",
    holder_side: "b",
    started_on: "2026-08-01",
    ended_on: null,
    is_active: true,
    is_published: true,
    notes: null,
    ...overrides,
  };
}
function session(id: number, day: number, format: TournamentSession["format"], playedOn: string): TournamentSession {
  return { id, tournament_id: 1, round_id: 100 + id, day_number: day, name: `Day ${day}`, format, played_on: playedOn, is_locked: false };
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
async function renderPage() {
  render(<TournamentLandingPage />);
  await act(async () => {
    await flush();
  });
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  mocks.getActiveTournament.mockReset();
  mocks.getTournamentSessions.mockReset();
  mocks.getTournamentPlayers.mockReset();
  mocks.getTournamentPlayers.mockResolvedValue([]);
  mocks.loadSessionMatches.mockReset();
  mocks.players = [];
});

describe("tournament landing", () => {
  it("lists all 3 days + pairings for a published future-dated tournament, each linking to its scorecard", async () => {
    mocks.getActiveTournament.mockResolvedValue(tournament());
    mocks.getTournamentSessions.mockResolvedValue([
      session(9, 1, "greensomes", "2026-08-01"),
      session(10, 2, "four_ball_match", "2026-08-02"),
      session(11, 3, "singles_match", "2026-08-03"),
    ]);
    mocks.loadSessionMatches.mockImplementation(async (sessionId: number) => {
      if (sessionId === 9)
        return [
          makeLoaded({
            id: 500,
            format: "greensomes",
            a: [{ playerId: 1, ch: 5, scored: {} }, { playerId: 2, ch: 15, scored: {} }],
            b: [{ playerId: 3, ch: 10, scored: {} }, { playerId: 4, ch: 20, scored: {} }],
          }),
        ];
      if (sessionId === 10)
        return [
          makeLoaded({
            id: 600,
            format: "four_ball_match",
            a: [{ playerId: 1, ch: 0, scored: {} }, { playerId: 2, ch: 0, scored: {} }],
            b: [{ playerId: 3, ch: 0, scored: {} }, { playerId: 4, ch: 0, scored: {} }],
          }),
        ];
      return [
        makeLoaded({ id: 700, format: "singles_match", a: [{ playerId: 1, ch: 0, scored: {} }], b: [{ playerId: 2, ch: 0, scored: {} }] }),
      ];
    });

    await renderPage();

    // All three days rendered.
    expect(screen.getByTestId("day-9")).toBeInTheDocument();
    expect(screen.getByTestId("day-10")).toBeInTheDocument();
    expect(screen.getByTestId("day-11")).toBeInTheDocument();
    expect(screen.getByText("2026 GOBS Ryder Cup")).toBeInTheDocument();

    // A match row per day, each linking to its scorecard.
    const row = screen.getByTestId("match-row-500");
    expect(row).toHaveAttribute("href", "/tournament/match/500");
    expect(screen.getByTestId("match-row-600")).toHaveAttribute("href", "/tournament/match/600");
    expect(screen.getByTestId("match-row-700")).toHaveAttribute("href", "/tournament/match/700");

    // Player names shown; tee time is "—".
    expect(row).toHaveTextContent("P1 / P2");
    expect(row).toHaveTextContent("—");

    // No day highlighted "Today" (future-dated).
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tournament-empty")).not.toBeInTheDocument();
  });

  it("renders the empty state when no tournament is published (Test only)", async () => {
    mocks.getActiveTournament.mockResolvedValue(tournament({ is_published: false }));
    await renderPage();
    expect(screen.getByTestId("tournament-empty")).toBeInTheDocument();
    expect(mocks.getTournamentSessions).not.toHaveBeenCalled();
  });

  it("renders the empty state when there is no active tournament at all", async () => {
    mocks.getActiveTournament.mockResolvedValue(null);
    await renderPage();
    expect(screen.getByTestId("tournament-empty")).toBeInTheDocument();
  });

  it("highlights the current day when a session is dated today", async () => {
    mocks.getActiveTournament.mockResolvedValue(tournament());
    mocks.getTournamentSessions.mockResolvedValue([session(9, 1, "greensomes", "2026-07-15")]); // today
    mocks.loadSessionMatches.mockResolvedValue([
      makeLoaded({ id: 500, format: "greensomes", a: [{ playerId: 1, ch: 5, scored: {} }, { playerId: 2, ch: 15, scored: {} }], b: [{ playerId: 3, ch: 10, scored: {} }, { playerId: 4, ch: 20, scored: {} }] }),
    ]);
    await renderPage();
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("device memory: Who-are-you → pick stores identity → Go to your match → Switch resets", async () => {
    mocks.getActiveTournament.mockResolvedValue(tournament());
    mocks.getTournamentSessions.mockResolvedValue([session(9, 1, "singles_match", "2026-07-15")]); // today
    mocks.loadSessionMatches.mockResolvedValue([
      makeLoaded({ id: 700, format: "singles_match", a: [{ playerId: 1, ch: 0, scored: {} }], b: [{ playerId: 2, ch: 0, scored: {} }] }),
    ]);
    await renderPage();

    // First visit — the one-time picker.
    expect(screen.getByTestId("who-are-you")).toBeInTheDocument();
    expect(screen.queryByTestId("go-to-your-match")).not.toBeInTheDocument();

    // Pick P1 → identity stored → one-tap Go to your match (the match P1 is in).
    await act(async () => {
      fireEvent.click(screen.getByTestId("whoami-1"));
      await flush();
    });
    expect(screen.getByTestId("device-identity")).toBeInTheDocument();
    expect(screen.getByTestId("go-to-your-match")).toHaveAttribute("href", "/tournament/match/700");
    expect(window.localStorage.getItem("gobs:tournament-player-id")).toBe("1");

    // Switch player → back to the picker, storage cleared.
    await act(async () => {
      fireEvent.click(screen.getByTestId("switch-player"));
      await flush();
    });
    expect(screen.getByTestId("who-are-you")).toBeInTheDocument();
    expect(window.localStorage.getItem("gobs:tournament-player-id")).toBeNull();
  });

  it("device memory: a stored identity resolves to the current day's match automatically", async () => {
    // Pre-store P1 (as if remembered from a prior day). Today's session (day 2)
    // has P1 in a DIFFERENT match — resolution follows the identity, not a match id.
    window.localStorage.setItem("gobs:tournament-player-id", "1");
    mocks.getActiveTournament.mockResolvedValue(tournament());
    mocks.getTournamentSessions.mockResolvedValue([session(10, 2, "singles_match", "2026-07-15")]); // today
    mocks.loadSessionMatches.mockResolvedValue([
      makeLoaded({ id: 610, format: "singles_match", a: [{ playerId: 2, ch: 0, scored: {} }], b: [{ playerId: 3, ch: 0, scored: {} }] }),
      makeLoaded({ id: 611, format: "singles_match", teamA_number: 3, teamB_number: 4, a: [{ playerId: 4, ch: 0, scored: {} }], b: [{ playerId: 1, ch: 0, scored: {} }] }),
    ]);
    await renderPage();

    expect(screen.queryByTestId("who-are-you")).not.toBeInTheDocument();
    expect(screen.getByTestId("go-to-your-match")).toHaveAttribute("href", "/tournament/match/611"); // P1's match today
  });

  it("Fix 1: a future-dated match resolves to the nearest match (doesn't blank), naming the day", async () => {
    // today = 2026-07-15; match is Aug 1 (future). Old behaviour blanked; now it
    // resolves to the player's nearest today-or-later match.
    window.localStorage.setItem("gobs:tournament-player-id", "1");
    mocks.getActiveTournament.mockResolvedValue(tournament());
    mocks.getTournamentSessions.mockResolvedValue([session(9, 1, "singles_match", "2026-08-01")]);
    mocks.loadSessionMatches.mockResolvedValue([
      makeLoaded({ id: 700, format: "singles_match", a: [{ playerId: 1, ch: 0, scored: {} }], b: [{ playerId: 2, ch: 0, scored: {} }] }),
    ]);
    await renderPage();
    const link = screen.getByTestId("go-to-your-match");
    expect(link).toHaveAttribute("href", "/tournament/match/700");
    expect(link).toHaveTextContent("Your Day 1 match"); // day-named, not "today"
    expect(screen.queryByTestId("no-match")).not.toBeInTheDocument();
  });

  it("Fix 1: picks the SOONEST today-or-later day when a player is matched on several", async () => {
    window.localStorage.setItem("gobs:tournament-player-id", "1");
    mocks.getActiveTournament.mockResolvedValue(tournament());
    mocks.getTournamentSessions.mockResolvedValue([
      session(9, 1, "singles_match", "2026-07-10"), // past
      session(10, 2, "singles_match", "2026-07-20"), // soonest upcoming
      session(11, 3, "singles_match", "2026-07-25"), // later
    ]);
    mocks.loadSessionMatches.mockImplementation(async (id: number) => {
      const mid = id === 9 ? 900 : id === 10 ? 1000 : 1100;
      return [makeLoaded({ id: mid, format: "singles_match", a: [{ playerId: 1, ch: 0, scored: {} }], b: [{ playerId: 2, ch: 0, scored: {} }] })];
    });
    await renderPage();
    const link = screen.getByTestId("go-to-your-match");
    expect(link).toHaveAttribute("href", "/tournament/match/1000"); // day 2 (soonest ≥ today)
    expect(link).toHaveTextContent("Your Day 2 match");
  });

  it("Fix 1: an all-past tournament falls back to the most recent match", async () => {
    window.localStorage.setItem("gobs:tournament-player-id", "1");
    mocks.getActiveTournament.mockResolvedValue(tournament());
    mocks.getTournamentSessions.mockResolvedValue([
      session(9, 1, "singles_match", "2026-07-01"),
      session(10, 2, "singles_match", "2026-07-05"), // most recent past
    ]);
    mocks.loadSessionMatches.mockImplementation(async (id: number) => {
      const mid = id === 9 ? 900 : 1000;
      return [makeLoaded({ id: mid, format: "singles_match", a: [{ playerId: 1, ch: 0, scored: {} }], b: [{ playerId: 2, ch: 0, scored: {} }] })];
    });
    await renderPage();
    expect(screen.getByTestId("go-to-your-match")).toHaveAttribute("href", "/tournament/match/1000");
  });

  it("Fix 1: a stored player genuinely not matched on any day shows the no-match note", async () => {
    window.localStorage.setItem("gobs:tournament-player-id", "99"); // in no match
    mocks.getActiveTournament.mockResolvedValue(tournament());
    mocks.getTournamentSessions.mockResolvedValue([session(9, 1, "singles_match", "2026-07-15")]);
    mocks.loadSessionMatches.mockResolvedValue([
      makeLoaded({ id: 700, format: "singles_match", a: [{ playerId: 1, ch: 0, scored: {} }], b: [{ playerId: 2, ch: 0, scored: {} }] }),
    ]);
    await renderPage();
    expect(screen.getByTestId("no-match")).toBeInTheDocument();
    expect(screen.queryByTestId("go-to-your-match")).not.toBeInTheDocument();
  });

  it("Fix 2: full-roster fallback lists all league players; a tournament player resolves normally", async () => {
    mocks.getActiveTournament.mockResolvedValue(tournament());
    mocks.getTournamentSessions.mockResolvedValue([session(9, 1, "singles_match", "2026-07-15")]);
    mocks.loadSessionMatches.mockResolvedValue([
      makeLoaded({ id: 700, format: "singles_match", a: [{ playerId: 1, ch: 0, scored: {} }], b: [{ playerId: 2, ch: 0, scored: {} }] }),
    ]);
    // Full league roster includes P1 (in tournament) + P8 (a league player NOT in it).
    mocks.players = [
      { id: 1, full_name: "Adam Apple", display_name: "Adam", is_active: true },
      { id: 8, full_name: "Zed Zephyr", display_name: "Zed", is_active: true },
    ];
    mocks.getTournamentPlayers.mockResolvedValue([{ player_id: 1 }, { player_id: 2 }]);

    await renderPage();
    // Open the full roster.
    await act(async () => {
      fireEvent.click(screen.getByTestId("see-all-players"));
      await flush();
    });
    expect(screen.getByTestId("all-players")).toBeInTheDocument();
    expect(screen.getByTestId("allplayers-1")).toBeInTheDocument();
    expect(screen.getByTestId("allplayers-8")).toBeInTheDocument();

    // Pick P1 (a tournament participant) → resolves normally to their match.
    await act(async () => {
      fireEvent.click(screen.getByTestId("allplayers-1"));
      await flush();
    });
    expect(screen.getByTestId("go-to-your-match")).toHaveAttribute("href", "/tournament/match/700");
  });

  it("Fix 2: picking a league player NOT in the tournament shows 'ask the admin' and does not store", async () => {
    mocks.getActiveTournament.mockResolvedValue(tournament());
    mocks.getTournamentSessions.mockResolvedValue([session(9, 1, "singles_match", "2026-07-15")]);
    mocks.loadSessionMatches.mockResolvedValue([
      makeLoaded({ id: 700, format: "singles_match", a: [{ playerId: 1, ch: 0, scored: {} }], b: [{ playerId: 2, ch: 0, scored: {} }] }),
    ]);
    mocks.players = [{ id: 8, full_name: "Zed Zephyr", display_name: "Zed", is_active: true }];
    mocks.getTournamentPlayers.mockResolvedValue([{ player_id: 1 }, { player_id: 2 }]); // 8 not in

    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTestId("see-all-players"));
      await flush();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("allplayers-8"));
      await flush();
    });
    expect(screen.getByTestId("not-in-tournament")).toHaveTextContent("ask the admin to add you");
    expect(window.localStorage.getItem("gobs:tournament-player-id")).toBeNull(); // not stored
    expect(screen.queryByTestId("go-to-your-match")).not.toBeInTheDocument();
  });

  it("isolates a day whose pairings fail to load; others still render", async () => {
    mocks.getActiveTournament.mockResolvedValue(tournament());
    mocks.getTournamentSessions.mockResolvedValue([
      session(9, 1, "greensomes", "2026-08-01"),
      session(10, 2, "four_ball_match", "2026-08-02"),
    ]);
    mocks.loadSessionMatches.mockImplementation(async (sessionId: number) => {
      if (sessionId === 9) throw new Error("mixed tees");
      return [makeLoaded({ id: 600, format: "four_ball_match", a: [{ playerId: 1, ch: 0, scored: {} }, { playerId: 2, ch: 0, scored: {} }], b: [{ playerId: 3, ch: 0, scored: {} }, { playerId: 4, ch: 0, scored: {} }] })];
    });
    await renderPage();
    expect(screen.getByText(/Couldn’t load this day’s pairings/)).toBeInTheDocument();
    expect(screen.getByTestId("match-row-600")).toBeInTheDocument();
  });
});
