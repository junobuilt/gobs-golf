// @vitest-environment jsdom
// The homepage tournament hero: renders ONLY for a live (is_published) tournament
// that hasn't ended; otherwise NULL — which is the homepage's byte-identical
// negative control (a null render adds zero DOM to the homepage).

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import type { Tournament } from "@/lib/tournament/types";

const mocks = vi.hoisted(() => ({ getActiveTournament: vi.fn() }));
vi.mock("@/lib/tournament/queries", () => ({ getActiveTournament: mocks.getActiveTournament }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => React.createElement("a", { href, ...rest }, children),
}));

import TournamentHero from "@/components/tournament/TournamentHero";

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 1, name: "2026 GOBS Ryder Cup", season_id: null, side_a_name: "USA", side_b_name: "Canada",
    holder_side: "b", started_on: "2026-08-01", ended_on: null, is_active: true, is_published: true, notes: null,
    ...overrides,
  };
}
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
async function renderHero() {
  render(<TournamentHero />);
  await act(async () => {
    await flush();
  });
}

beforeEach(() => {
  cleanup();
  mocks.getActiveTournament.mockReset();
});

describe("TournamentHero", () => {
  it("shows for a published, un-ended tournament and links to /tournament", async () => {
    mocks.getActiveTournament.mockResolvedValue(tournament());
    await renderHero();
    const hero = screen.getByTestId("tournament-hero");
    expect(hero).toHaveAttribute("href", "/tournament");
    expect(hero).toHaveTextContent("2026 GOBS Ryder Cup");
  });

  it("renders nothing when the tournament is Test (is_published false) — negative control", async () => {
    mocks.getActiveTournament.mockResolvedValue(tournament({ is_published: false }));
    await renderHero();
    expect(screen.queryByTestId("tournament-hero")).not.toBeInTheDocument();
  });

  it("renders nothing when the tournament has ended (ended_on set)", async () => {
    mocks.getActiveTournament.mockResolvedValue(tournament({ ended_on: "2026-08-05" }));
    await renderHero();
    expect(screen.queryByTestId("tournament-hero")).not.toBeInTheDocument();
  });

  it("renders nothing when there is no active tournament", async () => {
    mocks.getActiveTournament.mockResolvedValue(null);
    await renderHero();
    expect(screen.queryByTestId("tournament-hero")).not.toBeInTheDocument();
  });
});
