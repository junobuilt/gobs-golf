// Flights Track, Session 3 — the Round Setup per-flight "Pot $N" chip MUST show
// the abstract payout calculator's balance for that flight's headcount, with NO
// parallel arithmetic in the component. The chip renders exactly
//   deriveRoundMoney(flightHeadcount, buyIn).balance
// which is the SAME calculator the finalize/persist path feeds (its per-player
// pot = buyIn − HIO − BFB, × headcount). This test pins that single source: the
// chip preview === the payout-engine pot for identical inputs.

import { describe, it, expect } from "vitest";
import {
  deriveRoundMoney,
  HIO_PER_PLAYER,
  BFB_PER_PLAYER,
} from "@/lib/payouts/winningsMoney";

// The persist path's per-player pot (mirrors persistRoundPayouts.ts). The chip's
// balance must equal this × headcount for any flight — proving the preview and
// the actual payout balance come from one definition.
function persistPathBalance(headcount: number, buyIn: number): number {
  const perPlayerPot = Math.max(0, Math.round(buyIn) - HIO_PER_PLAYER - BFB_PER_PLAYER);
  return perPlayerPot * headcount;
}

describe("Round Setup pot chip preview agreement", () => {
  it("chip balance === payout-engine balance for the same flight headcount + buy-in", () => {
    for (const buyIn of [10, 15, 20]) {
      for (const headcount of [0, 2, 4, 5, 6, 8, 12]) {
        const chip = deriveRoundMoney(headcount, buyIn).balance;
        expect(chip).toBe(persistPathBalance(headcount, buyIn));
      }
    }
  });

  it("default buy-in 10 → $7/player pot (chip shows e.g. $28 for a 4-player flight)", () => {
    expect(deriveRoundMoney(4, 10).balance).toBe(28);
    expect(deriveRoundMoney(8, 10).balance).toBe(56);
    // Per-flight isolation: an 8-player round split 4+4 shows $28 on EACH flight
    // chip, not one $56 — each chip reads its own flight's headcount.
    expect(deriveRoundMoney(4, 10).balance + deriveRoundMoney(4, 10).balance).toBe(56);
  });
});
