// @vitest-environment jsdom
//
// Funds panel renders from fund_balances + recent fund_transactions. Funds are
// GLOBAL (no season toggle). S4b adds the Reset Fund write surface: a button on
// each card → DangerModal with a REQUIRED reason → resetFund(). The client
// never writes fund_transactions directly (RLS posture); resetFund() wraps the
// reset_fund RPC and is mocked here.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

const balancesMock = vi.hoisted(() => vi.fn());
const txnsMock = vi.hoisted(() => vi.fn());
const resetFundMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/payouts/loadWinnings", () => ({
  loadFundBalances: balancesMock,
  loadRecentFundTransactions: txnsMock,
}));
vi.mock("@/lib/payouts/resetFund", () => ({
  resetFund: resetFundMock,
}));

import FundsPanel from "@/components/winnings/FundsPanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FundsPanel", () => {
  it("renders BFB + HiO balances from the view", async () => {
    balancesMock.mockResolvedValue({ hio: 92, bfb: 184, hioLastMovement: null, bfbLastMovement: null });
    txnsMock.mockResolvedValue([]);

    render(<FundsPanel />);

    await waitFor(() => expect(screen.getByTestId("bfb-balance")).toHaveTextContent("$184"));
    expect(screen.getByTestId("hio-balance")).toHaveTextContent("$92");
  });

  it("lists recent transactions in the order returned, with signed amounts", async () => {
    balancesMock.mockResolvedValue({ hio: 0, bfb: 184, hioLastMovement: null, bfbLastMovement: null });
    txnsMock.mockResolvedValue([
      { fund: "bfb", amount: 48, reason: "buyin_bfb", created_at: "2026-05-28T00:00:00Z", label: "BFB contribution" },
      { fund: "bfb", amount: -320, reason: "reset", created_at: "2026-04-30T00:00:00Z", label: "Fund reset" },
    ]);

    render(<FundsPanel />);

    await waitFor(() => expect(screen.getByText("+$48")).toBeInTheDocument());
    expect(screen.getByText("−$320")).toBeInTheDocument();
  });

  it("renders a Reset Fund button on each card (S4b)", async () => {
    balancesMock.mockResolvedValue({ hio: 0, bfb: 0, hioLastMovement: null, bfbLastMovement: null });
    txnsMock.mockResolvedValue([]);

    render(<FundsPanel />);
    await waitFor(() => expect(screen.getByTestId("reset-bfb-btn")).toBeEnabled());
    expect(screen.getByTestId("reset-hio-btn")).toBeInTheDocument();
  });

  it("reset modal shows the current balance and gates confirm on a required reason", async () => {
    balancesMock.mockResolvedValue({ hio: 0, bfb: 184, hioLastMovement: null, bfbLastMovement: null });
    txnsMock.mockResolvedValue([]);

    render(<FundsPanel />);
    await waitFor(() => expect(screen.getByTestId("reset-bfb-btn")).toBeEnabled());

    fireEvent.click(screen.getByTestId("reset-bfb-btn"));

    // Modal per mockup: title + current balance ($184, the non-zero start).
    expect(screen.getByText("Reset BFB Fund?")).toBeInTheDocument();
    expect(screen.getByText(/zero out the BFB Fund balance of \$184/)).toBeInTheDocument();

    // After the 1.5s dangerous-action delay, confirm is STILL disabled while
    // the reason is empty (server also rejects, but the UI gates first).
    await waitFor(
      () => expect(screen.getByRole("button", { name: "Reset Fund" })).toBeInTheDocument(),
      { timeout: 2500 },
    );
    expect(screen.getByRole("button", { name: "Reset Fund" })).toBeDisabled();

    // Typing a reason enables it.
    fireEvent.change(screen.getByLabelText("Fund reset reason"), {
      target: { value: "Donated to Blaine Food Bank" },
    });
    expect(screen.getByRole("button", { name: "Reset Fund" })).toBeEnabled();

    // Nothing was written while gated.
    expect(resetFundMock).not.toHaveBeenCalled();
  });

  it("confirming a reset calls resetFund and refreshes the card to $0 + a Fund reset entry", async () => {
    // NON-ZERO start (negative control): the reset must do real work.
    balancesMock
      .mockResolvedValueOnce({ hio: 0, bfb: 184, hioLastMovement: null, bfbLastMovement: null })
      .mockResolvedValueOnce({ hio: 0, bfb: 0, hioLastMovement: null, bfbLastMovement: null });
    txnsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { fund: "bfb", amount: -184, reason: "reset", created_at: "2026-06-08T00:00:00Z", label: "Fund reset" },
      ]);
    resetFundMock.mockResolvedValue(undefined);

    render(<FundsPanel />);
    await waitFor(() => expect(screen.getByTestId("bfb-balance")).toHaveTextContent("$184"));

    fireEvent.click(screen.getByTestId("reset-bfb-btn"));
    fireEvent.change(screen.getByLabelText("Fund reset reason"), {
      target: { value: "Donated to Blaine Food Bank" },
    });
    const confirm = await waitFor(
      () => {
        const b = screen.getByRole("button", { name: "Reset Fund" });
        expect(b).toBeEnabled();
        return b;
      },
      { timeout: 2500 },
    );

    fireEvent.click(confirm);

    // Called with the fund + trimmed reason; card refreshes to $0; ledger shows it.
    await waitFor(() =>
      expect(resetFundMock).toHaveBeenCalledWith("bfb", "Donated to Blaine Food Bank"),
    );
    await waitFor(() => expect(screen.getByTestId("bfb-balance")).toHaveTextContent("$0"));
    expect(screen.getByText(/Fund reset/)).toBeInTheDocument();
    // Modal closed.
    expect(screen.queryByText("Reset BFB Fund?")).not.toBeInTheDocument();
  });
});
