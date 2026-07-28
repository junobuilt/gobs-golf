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
  loadSessionMatches: vi.fn(),
}));

vi.mock("@/lib/tournament/queries", () => ({
  getActiveTournament: mocks.getActiveTournament,
  getTournamentSessions: mocks.getTournamentSessions,
}));
vi.mock("@/lib/tournament/loadMatch", () => ({
  loadSessionMatches: mocks.loadSessionMatches,
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
  mocks.loadSessionMatches.mockReset();
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

  it("device memory: a stored identity with no match today shows the no-match note", async () => {
    window.localStorage.setItem("gobs:tournament-player-id", "1");
    mocks.getActiveTournament.mockResolvedValue(tournament());
    mocks.getTournamentSessions.mockResolvedValue([session(9, 1, "singles_match", "2026-08-01")]); // NOT today
    mocks.loadSessionMatches.mockResolvedValue([
      makeLoaded({ id: 700, format: "singles_match", a: [{ playerId: 1, ch: 0, scored: {} }], b: [{ playerId: 2, ch: 0, scored: {} }] }),
    ]);
    await renderPage();
    expect(screen.getByTestId("device-identity")).toBeInTheDocument();
    expect(screen.getByTestId("no-match-today")).toBeInTheDocument();
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
