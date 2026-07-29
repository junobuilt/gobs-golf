// @vitest-environment jsdom
//
// The two REQUIRED cross-surface SSOT guards for the tournament frontend:
//
//  (a) The standardized PointsBar derives an IDENTICAL cup score / thresholds /
//      holder on the Home hero, Tournament Home, and Scoreboard — because all
//      three feed it from the one deriveCupBar(loadDashboard()) path.
//  (b) A given match renders the SAME matchStatus() string on the homepage card,
//      the Tournament Home card, and the Scoreboard row — one helper, one string.
//
// Each surface is rendered in isolation from the SAME mocked loader output, its
// values captured, then compared. A divergence here is the render-layer drift
// class the unit tests miss.

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { makeLoaded } from "../support/matchFixture";
import { matchSidePoints } from "@/lib/tournament/matchStatus";
import type { LoadedMatch, Tournament, TournamentSession } from "@/lib/tournament/types";

const mocks = vi.hoisted(() => ({
  getActiveTournament: vi.fn(),
  getTournamentSessions: vi.fn(),
  getPointAdjustments: vi.fn(),
  getTournamentPlayers: vi.fn(),
  loadSessionMatches: vi.fn(),
}));

vi.mock("@/lib/tournament/queries", () => ({
  getActiveTournament: mocks.getActiveTournament,
  getTournamentSessions: mocks.getTournamentSessions,
  getPointAdjustments: mocks.getPointAdjustments,
  getTournamentPlayers: mocks.getTournamentPlayers,
}));
vi.mock("@/lib/tournament/loadMatch", () => ({ loadSessionMatches: mocks.loadSessionMatches }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) } }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => React.createElement("a", { href, ...rest }, children),
}));
vi.mock("@/lib/date", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/date")>();
  return { ...actual, todayLocal: () => "2026-08-01" };
});

import TournamentHero from "@/components/tournament/TournamentHero";
import TournamentLandingPage from "@/app/tournament/page";
import TournamentDashboardPage from "@/app/tournament/dashboard/page";

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 1, name: "2026 GOBS Ryder Cup", season_id: null, side_a_name: "USA", side_b_name: "Canada",
    holder_side: "b", started_on: "2026-08-01", ended_on: null, is_active: true, is_published: true, notes: null,
    ...overrides,
  };
}
function session(id: number, day: number, playedOn: string): TournamentSession {
  return { id, tournament_id: 1, round_id: 100 + id, day_number: day, name: `Day ${day}`, format: "singles_match", played_on: playedOn, is_locked: false };
}

// Match 500: USA 2 UP live (wins 1,2, halves 3). 501: decided USA. 502: pending.
function match500(): LoadedMatch {
  return makeLoaded({ id: 500, format: "singles_match", a: [{ playerId: 1, ch: 0, scored: { 1: 3, 2: 3, 3: 4 } }], b: [{ playerId: 2, ch: 0, scored: { 1: 5, 2: 5, 3: 4 } }] });
}
function match501(): LoadedMatch {
  const flat = (g: number) => Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, g]));
  return makeLoaded({ id: 501, format: "singles_match", a: [{ playerId: 3, ch: 0, scored: flat(3) }], b: [{ playerId: 4, ch: 0, scored: flat(5) }] });
}
function match502(): LoadedMatch {
  return makeLoaded({ id: 502, format: "singles_match", a: [{ playerId: 5, ch: 0, scored: {} }], b: [{ playerId: 6, ch: 0, scored: {} }] });
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.getActiveTournament.mockResolvedValue(tournament());
  mocks.getTournamentSessions.mockResolvedValue([session(9, 1, "2026-08-01"), session(10, 2, "2026-08-02")]);
  mocks.getPointAdjustments.mockResolvedValue([]);
  mocks.getTournamentPlayers.mockResolvedValue([]);
  mocks.loadSessionMatches.mockImplementation(async (id: number) => (id === 9 ? [match500(), match501()] : [match502()]));
});

// Render one surface, run its effects, return the live document, then the caller
// reads testids and cleans up.
async function renderSurface(node: React.ReactElement) {
  render(node);
  await act(async () => { await flush(); });
}

describe("(a) PointsBar is identical across Home / Tournament Home / Scoreboard", () => {
  it("same cup score, thresholds, and holder on all three surfaces", async () => {
    const read = () => ({
      a: screen.getByTestId("pointsbar-pts-a").textContent,
      b: screen.getByTestId("pointsbar-pts-b").textContent,
      capA: screen.getByTestId("pointsbar-cap-a").textContent,
      capC: screen.getByTestId("pointsbar-cap-c").textContent,
    });

    await renderSurface(<TournamentHero />);
    const home = read();
    cleanup();

    await renderSurface(<TournamentLandingPage />);
    const thome = read();
    cleanup();

    await renderSurface(<TournamentDashboardPage />);
    const board = read();
    cleanup();

    // Banked score: 1 decided USA win → USA 1, Canada 0.
    expect(home.a).toBe("1");
    expect(home.b).toBe("0");
    // Holder retain line (Canada holds; total 3 → retain 1.5).
    expect(home.capA).toContain("to win the cup");
    expect(home.capC).toContain("Canada holds the cup");
    expect(home.capC).toContain("1½–1½");

    // Identical across all three.
    expect(thome).toEqual(home);
    expect(board).toEqual(home);
  });
});

describe("(b) matchStatus string + pts agree across the three surfaces", () => {
  it("match 500 reads '2 UP' on the homepage card, Tournament Home card, and Scoreboard row", async () => {
    await renderSurface(<TournamentHero />);
    const homeStatus = screen.getByTestId("tmatch-status-500").textContent;
    cleanup();

    await renderSurface(<TournamentLandingPage />);
    const thomeStatus = screen.getByTestId("tmatch-status-500").textContent;
    cleanup();

    await renderSurface(<TournamentDashboardPage />);
    const boardStatus = screen.getByTestId("dash-status-500").textContent;
    // The Scoreboard row also shows the per-match pts (canonical matchSidePoints).
    const pts = matchSidePoints(match500());
    expect(screen.getByTestId("dash-match-500")).toHaveTextContent(pts.a); // "2½"
    expect(screen.getByTestId("dash-match-500")).toHaveTextContent(pts.b); // "½"
    cleanup();

    expect(homeStatus).toBe("2 UP");
    expect(thomeStatus).toBe("2 UP");
    expect(boardStatus).toBe("2 UP");
  });
});
