import { describe, it, expect } from "vitest";
import { calculatePayouts } from "@/lib/payoutEngine";

// Unit tests against the four worked examples in docs/PAYOUT_ENGINE.md §10.
// All four are asserted exactly as written in the (corrected 2026-06-07) doc —
// no doc/test divergence.

describe("payout engine — PAYOUT_ENGINE.md §10 worked examples", () => {
  it("Example A — small pot, clean fit (8 / 2 / $56)", () => {
    const r = calculatePayouts({ players: 8, team_size: 2, balance: 56 });
    expect(r.places_paid).toBe(3);
    expect(r.per_player).toEqual([15, 8, 5]);
    expect(r.total_paid).toBe(56);
    expect(r.bfb_sweep).toBe(0);
  });

  it("Example B — cap activates, leftover spreads (22 / 2 / $154)", () => {
    const r = calculatePayouts({ players: 22, team_size: 2, balance: 154 });
    expect(r.places_paid).toBe(4);
    expect(r.per_player).toEqual([25, 22, 19, 11]);
    expect(r.total_paid).toBe(154);
    expect(r.bfb_sweep).toBe(0);
  });

  it("Example C — maximum compression (30 / 2 / $210)", () => {
    const r = calculatePayouts({ players: 30, team_size: 2, balance: 210 });
    expect(r.places_paid).toBe(4);
    expect(r.per_player).toEqual([25, 24, 23, 22]);
    expect(r.total_paid).toBe(188);
    expect(r.bfb_sweep).toBe(22);
  });

  it("Example D — sub-floor requires cascade (24 / 4 / $168)", () => {
    const r = calculatePayouts({ players: 24, team_size: 4, balance: 168 });
    expect(r.places_paid).toBe(4);
    expect(r.per_player).toEqual([18, 11, 8, 5]);
    expect(r.total_paid).toBe(168);
    expect(r.bfb_sweep).toBe(0);
  });
});

describe("payout engine — structural invariants (abstract mode)", () => {
  it("never exceeds the per-player cap at 1st place", () => {
    for (let players = 4; players <= 60; players += 2) {
      for (const team_size of [2, 3, 4] as const) {
        const balance = players * 7;
        const r = calculatePayouts({ players, team_size, balance });
        if (r.places_paid > 0) {
          expect(r.per_player[0]).toBeLessThanOrEqual(25);
        }
      }
    }
  });

  it("respects the floor on every paid place when a payout exists", () => {
    for (let players = 4; players <= 60; players += 2) {
      for (const team_size of [2, 3, 4] as const) {
        const balance = players * 7;
        const r = calculatePayouts({ players, team_size, balance });
        for (const amount of r.per_player) {
          expect(amount).toBeGreaterThanOrEqual(5);
        }
      }
    }
  });

  it("keeps strictly descending places (no ties) with at least a $1 gap", () => {
    for (let players = 4; players <= 60; players += 2) {
      for (const team_size of [2, 3, 4] as const) {
        const balance = players * 7;
        const r = calculatePayouts({ players, team_size, balance });
        for (let i = 1; i < r.per_player.length; i++) {
          expect(r.per_player[i]).toBeLessThan(r.per_player[i - 1]);
        }
      }
    }
  });

  it("conserves dollars: total_paid + bfb_sweep === balance, sweep ≥ 0", () => {
    for (let players = 4; players <= 60; players += 2) {
      for (const team_size of [2, 3, 4] as const) {
        const balance = players * 7;
        const r = calculatePayouts({ players, team_size, balance });
        expect(r.total_paid + r.bfb_sweep).toBe(balance);
        expect(r.bfb_sweep).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("holds all hard rules across a broad input sweep (property fuzz)", () => {
    // Wide sweep over players, team sizes, and balances. Exercises the deeper
    // cascade-balancing paths (recursive gap lift, intermediate donor) that the
    // fixed golden rows do not all traverse, while asserting the hard rules on
    // every result: cap, floor, strict ordering, and dollar conservation.
    for (let players = 4; players <= 60; players += 1) {
      for (const team_size of [2, 3, 4] as const) {
        for (let balance = 0; balance <= 300; balance += 1) {
          const r = calculatePayouts({ players, team_size, balance });
          // Conservation + non-negative sweep always hold.
          expect(r.total_paid + r.bfb_sweep).toBe(balance);
          expect(r.bfb_sweep).toBeGreaterThanOrEqual(0);
          // §9 last resort: when the balance is too small to pay even one
          // team the $5 floor (balance < team_size * FLOOR), the engine pays
          // floor(balance/team_size) as a single capped place. The floor rule
          // is otherwise inviolate.
          const floorReachable = balance >= team_size * 5;
          for (let i = 0; i < r.per_player.length; i++) {
            expect(r.per_player[i]).toBeLessThanOrEqual(25); // cap
            if (floorReachable) {
              expect(r.per_player[i]).toBeGreaterThanOrEqual(5); // floor
            }
            if (i > 0) {
              // Strictly descending — at least the $1 fallback gap.
              expect(r.per_player[i]).toBeLessThan(r.per_player[i - 1]);
            }
          }
        }
      }
    }
  }, 20000); // ~54k engine runs; raise above the 5s default so it can't flake
             // on a timeout under parallel suite load.

  it("number of places paid matches the §7 Step 1 target ladder", () => {
    // 2 teams → 1, 3 → 2, 4–5 → 3, ≥6 → 4. Use a balance large enough that no
    // place is dropped for floor reasons.
    const cases: Array<[number, 2 | 3 | 4, number]> = [
      [4, 2, 1], // 2 teams
      [6, 2, 2], // 3 teams
      [8, 2, 3], // 4 teams
      [10, 2, 3], // 5 teams
      [12, 2, 4], // 6 teams
    ];
    for (const [players, team_size, expectedPlaces] of cases) {
      const r = calculatePayouts({ players, team_size, balance: players * 7 });
      expect(r.places_paid).toBe(expectedPlaces);
    }
  });
});
