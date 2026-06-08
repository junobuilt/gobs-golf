// @vitest-environment jsdom
//
// What-if Calculator must DISPLAY the engine result, never reimplement payout
// math. We assert the rendered amounts equal calculatePayouts(...) output.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import CalculatorPanel from "@/components/winnings/CalculatorPanel";
import { calculatePayouts } from "@/lib/payoutEngine";

afterEach(cleanup);

describe("CalculatorPanel", () => {
  it("renders the engine's payout for 24 players / 2-per (golden 25/23/20/16, sweep 0)", () => {
    render(<CalculatorPanel buyIn={10} />);
    // balance = 24 * (10-3) = 168. Defaults are 24 players / 2-per.
    const expected = calculatePayouts({ players: 24, team_size: 2, balance: 168 });
    expect(expected.per_player).toEqual([25, 23, 20, 16]); // sanity: matches golden
    expect(expected.bfb_sweep).toBe(0);

    for (const amt of expected.per_player) {
      expect(screen.getByText(`$${amt}/player`)).toBeInTheDocument();
    }
    expect(screen.getByText(`$${expected.total_paid}`)).toBeInTheDocument(); // total paid
    expect(screen.getByText("Projected Payouts (12 teams, $168 balance)")).toBeInTheDocument();
  });

  it("recomputes via the engine when inputs change", () => {
    render(<CalculatorPanel buyIn={10} />);
    const playersInput = screen.getByLabelText("Number of players") as HTMLInputElement;
    fireEvent.change(playersInput, { target: { value: "16" } });

    const expected = calculatePayouts({ players: 16, team_size: 2, balance: 112 });
    for (const amt of expected.per_player) {
      expect(screen.getAllByText(`$${amt}/player`).length).toBeGreaterThan(0);
    }
  });

  it("shows 'not enough players' when players < 2 × team size", () => {
    render(<CalculatorPanel buyIn={10} />);
    const playersInput = screen.getByLabelText("Number of players") as HTMLInputElement;
    fireEvent.change(playersInput, { target: { value: "3" } }); // 3 < 2*2

    expect(screen.getByText("Not enough players for a payout")).toBeInTheDocument();
    expect(screen.queryByText(/\/player/)).not.toBeInTheDocument();
  });
});
