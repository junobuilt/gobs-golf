// @vitest-environment jsdom
//
// By Player sub-view: renders one row per player (ranked by net), shows
// signed net + avg, expands to the per-round drill, filters by the season
// toggle, and shows an empty state. loadPlayerWinnings is mocked; SeasonToggle
// is real.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const playerMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payouts/loadPlayerWinnings", () => ({
  loadPlayerWinnings: playerMock,
}));

import ByPlayerPanel from "@/components/winnings/ByPlayerPanel";
import { MONEY } from "@/components/winnings/moneyTokens";

const SEASON = { id: 1, name: "2026 Season", started_on: "2026-01-01", ended_on: null, is_active: true, created_at: "" } as any;

// Two players: a winner (+$142) and a loser (−$67). Winner first = ranked.
function fixture() {
  return [
    {
      playerId: 1, name: "Bill Harmon", roundsPlayed: 19, net: 142, avg: 142 / 19,
      rounds: [
        { roundId: 9, playedOn: "2026-06-16", format: "2_ball", won: 34, buyIn: 10, net: 24 },
        { roundId: 8, playedOn: "2026-06-12", format: "gobs_stableford", won: 0, buyIn: 10, net: -10 },
      ],
    },
    {
      playerId: 2, name: "Walt Brennan", roundsPlayed: 18, net: -67, avg: -67 / 18,
      rounds: [
        { roundId: 9, playedOn: "2026-06-16", format: "2_ball", won: 0, buyIn: 10, net: -10 },
      ],
    },
  ];
}

afterEach(cleanup);
beforeEach(() => playerMock.mockReset());

describe("ByPlayerPanel", () => {
  it("renders ranked rows with signed net + avg and is collapsed by default", async () => {
    playerMock.mockResolvedValue(fixture());
    render(<ByPlayerPanel activeSeason={SEASON} />);

    await waitFor(() => expect(screen.getByText("Bill Harmon")).toBeInTheDocument());
    expect(screen.getByText("+$142")).toBeInTheDocument();
    expect(screen.getByText("−$67")).toBeInTheDocument();
    expect(screen.getByText("19 rounds")).toBeInTheDocument();
    expect(screen.getByText(/avg \+\$7\.47/)).toBeInTheDocument(); // 142/19

    // Drill hidden until tapped.
    expect(screen.queryByText("GOBS Stableford")).not.toBeInTheDocument();
  });

  it("colours net green when up and red when down (AA tokens)", async () => {
    playerMock.mockResolvedValue(fixture());
    render(<ByPlayerPanel activeSeason={SEASON} />);
    await waitFor(() => expect(screen.getByText("+$142")).toBeInTheDocument());
    expect(screen.getByText("+$142")).toHaveStyle({ color: MONEY.pos });
    expect(screen.getByText("−$67")).toHaveStyle({ color: MONEY.neg });
  });

  it("expands a player's per-round drill on tap", async () => {
    playerMock.mockResolvedValue(fixture());
    render(<ByPlayerPanel activeSeason={SEASON} />);
    await waitFor(() => expect(screen.getByText("Bill Harmon")).toBeInTheDocument());

    fireEvent.click(screen.getAllByTestId("byplayer-row")[0]);
    expect(screen.getByText("GOBS Stableford")).toBeInTheDocument();
    // The winning round shows +$24, the missed round −$10.
    expect(screen.getByText("+$24")).toBeInTheDocument();
    const drillMinus = screen.getAllByText("−$10");
    expect(drillMinus.length).toBeGreaterThanOrEqual(1);
  });

  it("filters by the season toggle (this_season → id; all-time → null)", async () => {
    playerMock.mockResolvedValue([]);
    render(<ByPlayerPanel activeSeason={SEASON} />);
    await waitFor(() => expect(playerMock).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByRole("button", { name: "All-time" }));
    await waitFor(() => expect(playerMock).toHaveBeenCalledWith(null));
  });

  it("shows the empty state when no players have winnings", async () => {
    playerMock.mockResolvedValue([]);
    render(<ByPlayerPanel activeSeason={SEASON} />);
    await waitFor(() =>
      expect(screen.getByText(/No finalized rounds with payouts yet/)).toBeInTheDocument(),
    );
  });
});
