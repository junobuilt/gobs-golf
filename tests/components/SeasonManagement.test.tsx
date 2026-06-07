// @vitest-environment jsdom
// Component test for the admin Settings season section (H3.2 current season +
// End Season, H3.3 past seasons + Reopen). The seasons lib is mocked so we
// assert the rendering/wiring, not the DB layer (covered in seasons.test.ts).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const mocks = vi.hoisted(() => ({
  getActiveSeason: vi.fn(),
  listPastSeasons: vi.fn(),
  getRoundCountForSeason: vi.fn(),
  getInProgressRoundsForSeason: vi.fn(),
  endSeason: vi.fn(),
  reopenSeason: vi.fn(),
}));
vi.mock("@/lib/seasons", () => ({
  ...mocks,
  SeasonHasInProgressRounds: class extends Error {},
}));

import SeasonManagement from "@/app/admin/components/SeasonManagement";

const ACTIVE = {
  id: 1, name: "2026 Season", started_on: "2026-01-01",
  ended_on: null, is_active: true, created_at: "2026-01-01T00:00:00Z",
};
const PAST = {
  id: 0, name: "2025 Season", started_on: "2025-01-01",
  ended_on: "2025-12-31", is_active: false, created_at: "2025-01-01T00:00:00Z",
};

beforeEach(() => {
  mocks.getActiveSeason.mockResolvedValue(ACTIVE);
  mocks.listPastSeasons.mockResolvedValue([PAST]);
  mocks.getRoundCountForSeason.mockImplementation(async (id: number) => (id === 1 ? 16 : 30));
  mocks.getInProgressRoundsForSeason.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SeasonManagement", () => {
  it("renders the current season with round count and an End Season button", async () => {
    render(<SeasonManagement />);
    expect(await screen.findByTestId("current-season-name")).toHaveTextContent("2026 Season");
    expect(screen.getByText(/16 rounds played/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End Season" })).toBeInTheDocument();
  });

  it("renders past seasons with a Reopen button", async () => {
    render(<SeasonManagement />);
    expect(await screen.findByText("2025 Season")).toBeInTheDocument();
    expect(screen.getByText(/30 rounds/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
  });

  it("shows the empty state when no season is active", async () => {
    mocks.getActiveSeason.mockResolvedValue(null);
    render(<SeasonManagement />);
    expect(await screen.findByText(/No active season/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End Season" })).not.toBeInTheDocument();
  });
});
