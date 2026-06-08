// @vitest-environment jsdom
//
// Historical Payouts panel: renders rows, expands to per-team payouts, shows
// the override badge ONLY when hasOverride, FILTERS by the season toggle, and
// shows an empty state. The data lib is mocked; SeasonToggle is real.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const historyMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/payouts/loadWinnings", () => ({
  loadWinningsHistory: historyMock,
  winningsToCsv: () => "csv",
}));

import HistoryPanel from "@/components/winnings/HistoryPanel";

const SEASON = { id: 1, name: "2026 Season", started_on: "2026-01-01", ended_on: null, is_active: true, created_at: "" } as any;

function roundFixture(over: boolean) {
  return {
    roundId: 501,
    playedOn: "2026-05-28",
    format: "2_ball",
    numTeams: 12,
    headcount: 24,
    teamSize: 2,
    hasOverride: over,
    paid: 168,
    sweepToBfb: 0,
    contributed: 240,
    hio: 24,
    bfb: 48,
    balance: 168,
    teams: [
      { teamNumber: 1, place: 1, perPlayer: 25, teamSize: 2, totalForTeam: 50, isTied: false, roster: "Bill C · Dave K" },
      { teamNumber: 7, place: 2, perPlayer: 23, teamSize: 2, totalForTeam: 46, isTied: false, roster: "Wayne V · Jeff I" },
    ],
  };
}

afterEach(cleanup);
beforeEach(() => historyMock.mockReset());

describe("HistoryPanel", () => {
  it("renders a row and expands to per-team payouts on tap", async () => {
    historyMock.mockResolvedValue([roundFixture(false)]);
    render(<HistoryPanel activeSeason={SEASON} buyIn={10} />);

    await waitFor(() => expect(screen.getByText(/168 paid · \$0 to BFB/)).toBeInTheDocument());
    // collapsed: team rosters not shown yet
    expect(screen.queryByText("Bill C · Dave K")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("winnings-history-row"));
    expect(screen.getByText("Bill C · Dave K")).toBeInTheDocument();
    expect(screen.getByText("$25/player × 2")).toBeInTheDocument();
  });

  it("shows the Admin Override badge only when a round was overridden", async () => {
    historyMock.mockResolvedValue([roundFixture(false)]);
    render(<HistoryPanel activeSeason={SEASON} buyIn={10} />);
    await waitFor(() => expect(screen.getByTestId("winnings-history-row")).toBeInTheDocument());
    expect(screen.queryByText("Admin Override")).not.toBeInTheDocument();

    cleanup();
    historyMock.mockResolvedValue([roundFixture(true)]);
    render(<HistoryPanel activeSeason={SEASON} buyIn={10} />);
    await waitFor(() => expect(screen.getByText("Admin Override")).toBeInTheDocument());
  });

  it("filters by the season toggle (this_season → season id; all-time → null)", async () => {
    historyMock.mockResolvedValue([]);
    render(<HistoryPanel activeSeason={SEASON} buyIn={10} />);

    // default this_season → loader called with the active season id
    await waitFor(() => expect(historyMock).toHaveBeenCalledWith(1, 10));

    fireEvent.click(screen.getByRole("button", { name: "All-time" }));
    await waitFor(() => expect(historyMock).toHaveBeenCalledWith(null, 10));
  });

  it("renders the empty state when there are no payout rows", async () => {
    historyMock.mockResolvedValue([]);
    render(<HistoryPanel activeSeason={SEASON} buyIn={10} />);
    await waitFor(() =>
      expect(screen.getByText(/No finalized rounds with payouts yet/)).toBeInTheDocument(),
    );
  });
});
