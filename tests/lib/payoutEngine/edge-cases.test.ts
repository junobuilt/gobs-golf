import { describe, it, expect } from "vitest";
import { calculatePayouts } from "@/lib/payoutEngine";

// Edge cases from docs/PAYOUT_ENGINE.md §9 plus the Session-1 acceptance list.

describe("payout engine — edge cases", () => {
  it("balance = 0 → all zero, no sweep", () => {
    const r = calculatePayouts({ players: 12, team_size: 2, balance: 0 });
    expect(r.per_player).toEqual([]);
    expect(r.places_paid).toBe(0);
    expect(r.total_paid).toBe(0);
    expect(r.bfb_sweep).toBe(0);
    expect(r.team_payouts).toEqual([]);
  });

  it("players < 2 * team_size → empty payout (fewer than 2 teams)", () => {
    // 3 players, team_size 2 → 1 complete team → no payout. Whole balance
    // sweeps to BFB since there is no payable place.
    const r = calculatePayouts({ players: 3, team_size: 2, balance: 21 });
    expect(r.places_paid).toBe(0);
    expect(r.per_player).toEqual([]);
    expect(r.total_paid).toBe(0);
    expect(r.bfb_sweep).toBe(21);
  });

  it("exactly 1 team (players === team_size) → empty payout", () => {
    const r = calculatePayouts({ players: 4, team_size: 4, balance: 28 });
    expect(r.places_paid).toBe(0);
    expect(r.per_player).toEqual([]);
    expect(r.bfb_sweep).toBe(28);
  });

  it("2 teams → exactly 1 place, capped, remainder sweeps", () => {
    // §9: 1st gets min(floor(balance / team_size), CAP).
    const r = calculatePayouts({ players: 4, team_size: 2, balance: 100 });
    expect(r.places_paid).toBe(1);
    expect(r.per_player).toEqual([25]); // floor(100/2)=50, capped to 25
    expect(r.total_paid).toBe(50);
    expect(r.bfb_sweep).toBe(50);
  });

  it("maximum compression (30 / 2 / $210) → $25/$24/$23/$22, $22 sweep", () => {
    const r = calculatePayouts({ players: 30, team_size: 2, balance: 210 });
    expect(r.per_player).toEqual([25, 24, 23, 22]);
    expect(r.bfb_sweep).toBe(22);
  });

  it("remainder players (non-divisible) do not affect the result", () => {
    // 13 players / team_size 2 → 6 complete teams (one leftover player).
    // Result must match 12 players / team_size 2 at the same balance.
    const odd = calculatePayouts({ players: 13, team_size: 2, balance: 84 });
    const even = calculatePayouts({ players: 12, team_size: 2, balance: 84 });
    expect(odd.per_player).toEqual(even.per_player);
    expect(odd.places_paid).toBe(even.places_paid);
  });

  it("100-player stress test → valid result in < 10ms", () => {
    const start = performance.now();
    const r = calculatePayouts({ players: 100, team_size: 2, balance: 700 });
    const elapsed = performance.now() - start;

    expect(r.places_paid).toBe(4);
    expect(r.per_player[0]).toBeLessThanOrEqual(25);
    expect(r.total_paid + r.bfb_sweep).toBe(700);
    expect(elapsed).toBeLessThan(10);
  });
});
