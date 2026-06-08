// @vitest-environment jsdom
//
// Historical Payouts panel: renders rows, expands to per-team payouts, shows
// the override badge ONLY when hasOverride, FILTERS by the season toggle, and
// shows an empty state. S4b adds the per-team Edit/Revert write surface →
// DangerModal (current/new/reason, gated) → override/revert lib → reload, plus
// the discrepancy flag when payouts exceed the pot. The data + override libs
// are mocked; SeasonToggle + DangerModal are real.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const historyMock = vi.hoisted(() => vi.fn());
const overrideMock = vi.hoisted(() => vi.fn());
const revertMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/payouts/loadWinnings", () => ({
  loadWinningsHistory: historyMock,
  winningsToCsv: () => "csv",
}));
vi.mock("@/lib/payouts/overrideRoundPayout", () => ({
  overrideRoundPayout: overrideMock,
  revertRoundPayout: revertMock,
}));

import HistoryPanel from "@/components/winnings/HistoryPanel";

const SEASON = { id: 1, name: "2026 Season", started_on: "2026-01-01", ended_on: null, is_active: true, created_at: "" } as any;

// `over` makes Team 1 an overridden row (engine $25 → $30). Team 7 is always
// engine-clean. `paid`/`balance` default to a reconciling round.
function roundFixture(over: boolean, opts: { paid?: number; balance?: number } = {}) {
  const balance = opts.balance ?? 168;
  const paid = opts.paid ?? 168;
  return {
    roundId: 501,
    playedOn: "2026-05-28",
    format: "2_ball",
    numTeams: 12,
    headcount: 24,
    teamSize: 2,
    hasOverride: over,
    paid,
    sweepToBfb: balance - paid,
    contributed: 240,
    hio: 24,
    bfb: 48,
    balance,
    teams: [
      {
        teamNumber: 1, place: 1, perPlayer: over ? 30 : 25, teamSize: 2,
        totalForTeam: over ? 60 : 50, isTied: false, roster: "Bill C · Dave K",
        wasOverridden: over, originalAmount: over ? 25 : null,
        overrideReason: over ? "bump" : null,
      },
      {
        teamNumber: 7, place: 2, perPlayer: 23, teamSize: 2, totalForTeam: 46,
        isTied: false, roster: "Wayne V · Jeff I",
        wasOverridden: false, originalAmount: null, overrideReason: null,
      },
    ],
  };
}

afterEach(cleanup);
beforeEach(() => {
  historyMock.mockReset();
  overrideMock.mockReset();
  revertMock.mockReset();
});

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

  // --- S4b override/revert surface --------------------------------------

  it("Edit opens the override modal (pre-filled) and gates confirm on a required reason", async () => {
    historyMock.mockResolvedValue([roundFixture(false)]);
    render(<HistoryPanel activeSeason={SEASON} buyIn={10} />);
    await waitFor(() => expect(screen.getByTestId("winnings-history-row")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("winnings-history-row")); // expand
    fireEvent.click(screen.getAllByTestId("payout-edit-btn")[0]); // Team 1

    expect(screen.getByText("Override Team 1 payout?")).toBeInTheDocument();
    expect(screen.getByText(/Currently \$25\/player/)).toBeInTheDocument();
    expect(screen.getByLabelText("New per-player payout")).toHaveValue(25);

    // After the 1.5s delay the confirm is STILL disabled while reason is empty.
    await waitFor(
      () => expect(screen.getByRole("button", { name: "Save override" })).toBeInTheDocument(),
      { timeout: 2500 },
    );
    expect(screen.getByRole("button", { name: "Save override" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Override reason"), {
      target: { value: "side-pot correction" },
    });
    expect(screen.getByRole("button", { name: "Save override" })).toBeEnabled();
    expect(overrideMock).not.toHaveBeenCalled();
  });

  it("confirming an override calls overrideRoundPayout and reloads (badge appears)", async () => {
    // NEGATIVE CONTROL: starts un-overridden; reload returns the overridden round.
    historyMock
      .mockResolvedValueOnce([roundFixture(false)])
      .mockResolvedValue([roundFixture(true)]);
    overrideMock.mockResolvedValue(undefined);

    render(<HistoryPanel activeSeason={SEASON} buyIn={10} />);
    await waitFor(() => expect(screen.getByTestId("winnings-history-row")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("winnings-history-row"));
    fireEvent.click(screen.getAllByTestId("payout-edit-btn")[0]);
    fireEvent.change(screen.getByLabelText("New per-player payout"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Override reason"), { target: { value: "side-pot correction" } });

    const confirm = await waitFor(
      () => {
        const b = screen.getByRole("button", { name: "Save override" });
        expect(b).toBeEnabled();
        return b;
      },
      { timeout: 2500 },
    );
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(overrideMock).toHaveBeenCalledWith(501, 1, 30, "side-pot correction"),
    );
    // reload reflected the override → badge renders, modal closed.
    await waitFor(() => expect(screen.getByText("Admin Override")).toBeInTheDocument());
    expect(screen.queryByText("Override Team 1 payout?")).not.toBeInTheDocument();
  });

  it("shows Revert only on overridden rows and reverts via revertRoundPayout", async () => {
    historyMock.mockResolvedValue([roundFixture(true)]);
    overrideMock.mockResolvedValue(undefined);
    revertMock.mockResolvedValue(undefined);

    render(<HistoryPanel activeSeason={SEASON} buyIn={10} />);
    await waitFor(() => expect(screen.getByTestId("winnings-history-row")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("winnings-history-row")); // expand

    // Only Team 1 (overridden) has a Revert button; Team 7 does not.
    expect(screen.getAllByTestId("payout-revert-btn")).toHaveLength(1);
    expect(screen.getByText("was $25/player")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("payout-revert-btn"));
    expect(screen.getByText("Revert Team 1 payout?")).toBeInTheDocument();
    expect(screen.getByText(/original payout of \$25\/player/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Override reason"), { target: { value: "entered in error" } });
    const confirm = await waitFor(
      () => {
        const b = screen.getByRole("button", { name: "Revert to engine value" });
        expect(b).toBeEnabled();
        return b;
      },
      { timeout: 2500 },
    );
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(revertMock).toHaveBeenCalledWith(501, 1, "entered in error"),
    );
  });

  it("flags a reconciliation discrepancy when payouts exceed the pot, but not otherwise", async () => {
    // Overpaid: $200 paid vs $168 pot.
    historyMock.mockResolvedValue([roundFixture(true, { paid: 200, balance: 168 })]);
    render(<HistoryPanel activeSeason={SEASON} buyIn={10} />);
    await waitFor(() => expect(screen.getByTestId("winnings-history-row")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("winnings-history-row"));
    expect(screen.getByTestId("payout-discrepancy")).toHaveTextContent(/over the \$168 pot/);

    // Reconciling round: no flag.
    cleanup();
    historyMock.mockResolvedValue([roundFixture(false)]);
    render(<HistoryPanel activeSeason={SEASON} buyIn={10} />);
    await waitFor(() => expect(screen.getByTestId("winnings-history-row")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("winnings-history-row"));
    expect(screen.queryByTestId("payout-discrepancy")).not.toBeInTheDocument();
  });
});
