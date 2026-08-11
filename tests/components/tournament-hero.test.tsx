// @vitest-environment jsdom
// The homepage tournament hero: renders the standardized cup hero (PointsBar) +
// today's tournament match cards ONLY when tournament mode is publicly ON;
// otherwise NULL — the homepage's byte-identical negative control. The gate
// logic (published/ended/active) is covered in mode.test.ts; here we mock
// getTournamentMode and assert the hero's render vs null.

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { makeLoaded } from "../support/matchFixture";
import type { DashboardData } from "@/lib/tournament/loadDashboard";
import type { Tournament, TournamentSession } from "@/lib/tournament/types";

const mocks = vi.hoisted(() => ({ getTournamentMode: vi.fn(), loadDashboard: vi.fn() }));
vi.mock("@/lib/tournament/mode", () => ({ getTournamentMode: mocks.getTournamentMode }));
vi.mock("@/lib/tournament/loadDashboard", () => ({ loadDashboard: mocks.loadDashboard }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => React.createElement("a", { href, ...rest }, children),
}));
vi.mock("@/lib/date", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/date")>();
  return { ...actual, todayLocal: () => "2026-08-01" };
});

import TournamentHero from "@/components/tournament/TournamentHero";

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 1, name: "2026 GOBS Ryder Cup", season_id: null, side_a_name: "USA", side_b_name: "Canada",
    holder_side: "b", started_on: "2026-08-01", ended_on: null, is_active: true, is_published: true, planned_match_total: null, notes: null,
    ...overrides,
  };
}
function session(id: number, playedOn: string): TournamentSession {
  return { id, tournament_id: 1, round_id: 100 + id, day_number: 1, name: "Day 1", format: "singles_match", played_on: playedOn, is_locked: false, is_voided: false, handicap_allowance: null };
}
function data(): DashboardData {
  const live = makeLoaded({ id: 500, format: "singles_match", a: [{ playerId: 1, ch: 0, scored: { 1: 3, 2: 3, 3: 4 } }], b: [{ playerId: 2, ch: 0, scored: { 1: 5, 2: 5, 3: 4 } }] });
  return { standings: { banked: { a: 0, b: 0 }, projected: { a: 1, b: 0 }, inPlay: [] }, days: [{ session: session(9, "2026-08-01"), matches: [live], error: false }], adjustments: [] };
}

async function flush() { for (let i = 0; i < 6; i++) await Promise.resolve(); }
async function renderHero() {
  render(<TournamentHero />);
  await act(async () => { await flush(); });
}

beforeEach(() => {
  cleanup();
  mocks.getTournamentMode.mockReset();
  mocks.loadDashboard.mockReset();
});

describe("TournamentHero", () => {
  it("shows the cup hero + today's match cards when tournament mode is on", async () => {
    mocks.getTournamentMode.mockResolvedValue(tournament());
    mocks.loadDashboard.mockResolvedValue(data());
    await renderHero();

    expect(screen.getByTestId("tournament-hero")).toBeInTheDocument();
    expect(screen.getByTestId("cup-hero")).toHaveTextContent("2026 GOBS Ryder Cup");
    expect(screen.getByTestId("pointsbar-track")).toBeInTheDocument();
    // Footer CTA into Tournament Home.
    expect(screen.getByTestId("hero-to-tournament")).toHaveAttribute("href", "/tournament");
    // Today's match card + the card-split hint.
    expect(screen.getByTestId("tmatch-card-500")).toHaveAttribute("href", "/tournament/match/500");
    expect(screen.getByTestId("tmatch-status-500")).toHaveTextContent("2 UP");
    expect(screen.getByTestId("cardsplit-hint")).toHaveTextContent("plain grey");
  });

  it("renders nothing when tournament mode is off (negative control)", async () => {
    mocks.getTournamentMode.mockResolvedValue(null);
    await renderHero();
    expect(screen.queryByTestId("tournament-hero")).not.toBeInTheDocument();
    expect(mocks.loadDashboard).not.toHaveBeenCalled();
  });
});
