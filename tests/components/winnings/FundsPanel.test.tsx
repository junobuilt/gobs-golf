// @vitest-environment jsdom
//
// Funds panel renders from fund_balances + recent fund_transactions. Funds are
// GLOBAL (no season toggle). No Reset button in 4a.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

const balancesMock = vi.hoisted(() => vi.fn());
const txnsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/payouts/loadWinnings", () => ({
  loadFundBalances: balancesMock,
  loadRecentFundTransactions: txnsMock,
}));

import FundsPanel from "@/components/winnings/FundsPanel";

afterEach(cleanup);

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

  it("does NOT render a Reset button (reset is 4b)", async () => {
    balancesMock.mockResolvedValue({ hio: 0, bfb: 0, hioLastMovement: null, bfbLastMovement: null });
    txnsMock.mockResolvedValue([]);

    render(<FundsPanel />);
    await waitFor(() => expect(screen.getByTestId("bfb-balance")).toBeInTheDocument());
    expect(screen.queryByText(/reset fund/i)).not.toBeInTheDocument();
  });
});
