import { describe, it, expect } from "vitest";
import { calculatePayouts, splitTiedPot } from "@/lib/payoutEngine";
import type { TeamFinish } from "@/lib/payoutEngine";

// Tie resolution. Each scenario asserts values that ONLY the tie logic
// produces — they differ from the abstract base payout at the same places, so
// the assertions fail if tie handling is removed (negative control).

function bestN(team_number: number, net_score: number): TeamFinish {
  return { team_number, net_score, scoring_basis: "best_n" };
}
function stableford(team_number: number, net_score: number): TeamFinish {
  return { team_number, net_score, scoring_basis: "stableford" };
}

describe("tieResolver — paid-place combine & split", () => {
  it("2-way tie at 1st (paying 2 places) combines 1st+2nd, splits evenly", () => {
    // 6 / 2 / $42 → abstract base [14, 7]; pots $28 + $14 = $42.
    // Teams 1 & 2 tie at the top; team 3 finishes out of the money.
    const r = calculatePayouts({
      players: 6,
      team_size: 2,
      balance: 42,
      team_finishes: [bestN(1, 70), bestN(2, 70), bestN(3, 75)],
    });

    const paid = r.team_payouts;
    expect(paid).toHaveLength(2); // team 3 (3rd of 3, only 2 paid) gets nothing
    for (const t of paid) {
      expect(t.is_tied).toBe(true);
      expect(t.place).toBe(1);
      expect(t.per_player).toBe(10); // floor($42 / 4 players)
      expect(t.total_for_team).toBe(20);
    }
    // Negative control: base would have paid 1st $14 and 2nd $7, not $10 each.
    expect(paid.map((t) => t.per_player)).not.toContain(14);
    expect(r.total_paid).toBe(40);
    expect(r.bfb_sweep).toBe(2); // $42 − $40 indivisible remainder
  });

  it("3-way tie at 1st (paying 3 places) combines all 3, splits 3 ways", () => {
    // 8 / 2 / $56 → abstract base [15, 8, 5]; pots $30 + $16 + $10 = $56.
    const r = calculatePayouts({
      players: 8,
      team_size: 2,
      balance: 56,
      team_finishes: [bestN(1, 70), bestN(2, 70), bestN(3, 70), bestN(4, 80)],
    });

    const tied = r.team_payouts.filter((t) => t.is_tied);
    expect(tied).toHaveLength(3);
    for (const t of tied) {
      expect(t.place).toBe(1);
      expect(t.per_player).toBe(9); // floor($56 / 6 players)
      expect(t.total_for_team).toBe(18);
    }
    expect(r.team_payouts).toHaveLength(3); // team 4 unpaid
    expect(r.total_paid).toBe(54);
    expect(r.bfb_sweep).toBe(2);
  });

  it("4-way tie at 1st (paying 4 places) combines all 4, splits 4 ways", () => {
    // 12 / 2 / $84 → abstract base [18, 11, 8, 5]; pots sum to $84.
    const r = calculatePayouts({
      players: 12,
      team_size: 2,
      balance: 84,
      team_finishes: [
        bestN(1, 60),
        bestN(2, 60),
        bestN(3, 60),
        bestN(4, 60),
        bestN(5, 70),
        bestN(6, 72),
      ],
    });

    const tied = r.team_payouts.filter((t) => t.is_tied);
    expect(tied).toHaveLength(4);
    for (const t of tied) {
      expect(t.place).toBe(1);
      expect(t.per_player).toBe(10); // floor($84 / 8 players)
      expect(t.total_for_team).toBe(20);
    }
    expect(r.team_payouts).toHaveLength(4); // teams 5 & 6 unpaid
    expect(r.total_paid).toBe(80);
    expect(r.bfb_sweep).toBe(4);
  });

  it("2-way tie at the cutoff (4th & 5th, 4 paid) splits 4th's pot; 5th does not back in", () => {
    // 12 / 2 / $84 → base [18, 11, 8, 5]; 6 teams, only 4 paid.
    const r = calculatePayouts({
      players: 12,
      team_size: 2,
      balance: 84,
      team_finishes: [
        bestN(1, 60),
        bestN(2, 62),
        bestN(3, 64),
        bestN(4, 66),
        bestN(5, 66), // ties team 4 at the cutoff
        bestN(6, 70),
      ],
    });

    const byTeam = new Map(r.team_payouts.map((t) => [t.team_number, t]));
    // Places 1–3 paid normally, not tied.
    expect(byTeam.get(1)).toMatchObject({ place: 1, per_player: 18, is_tied: false });
    expect(byTeam.get(2)).toMatchObject({ place: 2, per_player: 11, is_tied: false });
    expect(byTeam.get(3)).toMatchObject({ place: 3, per_player: 8, is_tied: false });
    // 4th & 5th split only 4th's pot ($10): floor($10 / 4 players) = $2 each.
    expect(byTeam.get(4)).toMatchObject({ place: 4, per_player: 2, is_tied: true });
    expect(byTeam.get(5)).toMatchObject({ place: 4, per_player: 2, is_tied: true });
    // 5th does NOT back into a separate place; team 6 is unpaid.
    expect(byTeam.has(6)).toBe(false);
    expect(r.total_paid).toBe(36 + 22 + 16 + 8); // 18·2 + 11·2 + 8·2 + 2·2·2
    expect(r.bfb_sweep).toBe(2);
  });

  it("tie at two positions (1st-2nd tied AND 3rd-4th tied)", () => {
    // 12 / 2 / $84 → base [18, 11, 8, 5].
    const r = calculatePayouts({
      players: 12,
      team_size: 2,
      balance: 84,
      team_finishes: [
        bestN(1, 60),
        bestN(2, 60), // tie for 1st
        bestN(3, 64),
        bestN(4, 64), // tie for 3rd
        bestN(5, 70),
        bestN(6, 72),
      ],
    });

    const byTeam = new Map(r.team_payouts.map((t) => [t.team_number, t]));
    // 1st-2nd: combine $36 + $22 = $58, /4 players = $14 each.
    expect(byTeam.get(1)).toMatchObject({ place: 1, per_player: 14, is_tied: true });
    expect(byTeam.get(2)).toMatchObject({ place: 1, per_player: 14, is_tied: true });
    // 3rd-4th: combine $16 + $10 = $26, /4 players = $6 each.
    expect(byTeam.get(3)).toMatchObject({ place: 3, per_player: 6, is_tied: true });
    expect(byTeam.get(4)).toMatchObject({ place: 3, per_player: 6, is_tied: true });
    expect(r.total_paid).toBe(28 + 28 + 12 + 12);
    expect(r.bfb_sweep).toBe(4); // $58→$56 (sweep 2) + $26→$24 (sweep 2)
  });

  it("stableford sorts descending (higher score wins)", () => {
    // Same pots as the 2-way 1st-place case, but higher score is better.
    const r = calculatePayouts({
      players: 6,
      team_size: 2,
      balance: 42,
      team_finishes: [
        stableford(1, 30), // lowest → out of money
        stableford(2, 45),
        stableford(3, 45),
      ],
    });
    const paid = r.team_payouts;
    expect(paid.map((t) => t.team_number).sort()).toEqual([2, 3]);
    expect(paid.every((t) => t.is_tied && t.place === 1 && t.per_player === 10)).toBe(true);
    expect(paid.some((t) => t.team_number === 1)).toBe(false);
  });

  it("no ties → team_payouts mirror the abstract per-place amounts", () => {
    const input = { players: 12, team_size: 2 as const, balance: 84 };
    const abstract = calculatePayouts(input);
    const r = calculatePayouts({
      ...input,
      team_finishes: [
        bestN(1, 60),
        bestN(2, 62),
        bestN(3, 64),
        bestN(4, 66),
        bestN(5, 70),
        bestN(6, 72),
      ],
    });
    const paidPerPlayer = r.team_payouts
      .sort((a, b) => a.place - b.place)
      .map((t) => t.per_player);
    expect(paidPerPlayer).toEqual(abstract.per_player);
    expect(r.team_payouts.every((t) => !t.is_tied)).toBe(true);
    expect(r.total_paid).toBe(abstract.total_paid);
    expect(r.bfb_sweep).toBe(abstract.bfb_sweep);
  });

  it("no payout (1 team) → empty team_payouts even with finishes", () => {
    const r = calculatePayouts({
      players: 3,
      team_size: 2,
      balance: 21,
      team_finishes: [bestN(1, 70)],
    });
    expect(r.places_paid).toBe(0);
    expect(r.team_payouts).toEqual([]);
  });
});

describe("tieResolver — splitTiedPot helper (clamp behavior)", () => {
  it("caps the per-player split at CAP and sweeps the excess", () => {
    // Unreachable via the full API (the engine pre-caps 1st place), so the cap
    // branch is exercised directly here. $120 across 2 teams of 2 = 4 players →
    // $30/player raw, clamped to $25; excess sweeps.
    const split = splitTiedPot(120, 2, 2);
    expect(split.perPlayer).toBe(25); // negative control: would be 30 uncapped
    expect(split.totalForTeam).toBe(50);
    expect(split.sweep).toBe(20); // $120 − $25·2·2
  });

  it("pays a below-floor split as-is and flags it (v1 limitation)", () => {
    // $8 across 2 teams of 2 = $2/player, below the $5 floor. Paid as-is.
    const split = splitTiedPot(8, 2, 2);
    expect(split.perPlayer).toBe(2);
    expect(split.belowFloor).toBe(true);
    expect(split.totalForTeam).toBe(4);
    expect(split.sweep).toBe(0);
  });

  it("sweeps the indivisible remainder of an even split", () => {
    const split = splitTiedPot(42, 2, 2); // floor(42/4)=10, 10·4=40
    expect(split.perPlayer).toBe(10);
    expect(split.sweep).toBe(2);
    expect(split.belowFloor).toBe(false);
  });
});
