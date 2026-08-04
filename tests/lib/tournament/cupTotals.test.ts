// The SSOT accessor for the decidable total + thresholds (migration 040). These
// pin the exact liveTotal / winLine / retainLine / barSize semantics every
// surface reads, plus the per-side "points needed" interpretation and the clinch
// behaviour that the created-count-only math got wrong (TD45).

import { describe, it, expect } from "vitest";
import { cupTotals } from "@/lib/tournament/cupTotals";
import { cupOutcome, type CupState } from "@/lib/tournament/cup";
import type { Side } from "@/lib/tournament/types";

describe("cupTotals — liveTotal", () => {
  it("planned NULL, no voids → falls back to created count (pre-040 behaviour)", () => {
    const t = cupTotals({ createdCount: 8, voidedCount: 0, plannedTotal: null });
    expect(t.liveTotal).toBe(8);
    expect(t.barSize).toBe(8);
    expect(t.winLine).toBe(4.5);
    expect(t.retainLine).toBe(4);
  });

  it("planned declared (32), only Day-1 created (8) → liveTotal 32 (the TD45 fix)", () => {
    const t = cupTotals({ createdCount: 8, voidedCount: 0, plannedTotal: 32 });
    expect(t.liveTotal).toBe(32);
    expect(t.barSize).toBe(32);
    expect(t.winLine).toBe(16.5);
    expect(t.retainLine).toBe(16);
  });

  it("void subtracts from the pool: planned 32, 1 voided → liveTotal 31, thresholds shift", () => {
    const t = cupTotals({ createdCount: 8, voidedCount: 1, plannedTotal: 32 });
    expect(t.liveTotal).toBe(31);
    expect(t.winLine).toBe(16); // 31/2 + 0.5
    expect(t.retainLine).toBe(15.5);
  });

  it("planned NULL with voids → (created − voided)", () => {
    const t = cupTotals({ createdCount: 8, voidedCount: 2, plannedTotal: null });
    expect(t.liveTotal).toBe(6);
    expect(t.winLine).toBe(3.5);
    expect(t.retainLine).toBe(3);
  });

  it("under-declared clamp: planned 6 but 8 non-voided created → barSize can't shrink below 8", () => {
    const t = cupTotals({ createdCount: 8, voidedCount: 0, plannedTotal: 6 });
    // liveTotal follows the declared size, but the BAR can't be narrower than the
    // matches that actually exist and fill it.
    expect(t.liveTotal).toBe(6);
    expect(t.barSize).toBe(8);
    // barSize ≥ liveTotal always → fills never overflow the track.
    expect(t.barSize).toBeGreaterThanOrEqual(t.liveTotal);
  });
});

describe("cupTotals — per-side points needed", () => {
  // The challenger must reach the WIN line; the holder only needs the RETAIN line.
  const target = (t: ReturnType<typeof cupTotals>, holder: Side | null, side: Side) =>
    holder != null && side === holder ? t.retainLine : t.winLine;

  it("holder = Canada (b), planned 32 → USA needs 16.5 to win, Canada needs 16 to retain", () => {
    const t = cupTotals({ createdCount: 8, voidedCount: 0, plannedTotal: 32 });
    expect(target(t, "b", "a")).toBe(16.5); // USA = challenger
    expect(target(t, "b", "b")).toBe(16); // Canada = holder
  });

  it("holder = USA (a) → USA needs the retain line, Canada needs the win line", () => {
    const t = cupTotals({ createdCount: 24, voidedCount: 0, plannedTotal: 24 });
    expect(target(t, "a", "a")).toBe(12); // USA = holder → retain
    expect(target(t, "a", "b")).toBe(12.5); // Canada = challenger → win
  });
});

// Clinch is decided by cupOutcome fed the accessor's liveTotal. The core TD45
// bug: with planned > created, the trailing side must NOT be clinched out just
// because few matches exist yet — the uncreated planned matches are still points
// in play.
describe("clinch counts planned-but-uncreated matches (TD45)", () => {
  const verdict = (opts: {
    createdCount: number;
    voidedCount: number;
    plannedTotal: number | null;
    pointsA: number;
    pointsB: number;
    decided: number;
    holderSide?: Side | null;
  }): CupState => {
    const t = cupTotals({ createdCount: opts.createdCount, voidedCount: opts.voidedCount, plannedTotal: opts.plannedTotal });
    return cupOutcome({
      pointsA: opts.pointsA,
      pointsB: opts.pointsB,
      sideAName: "USA",
      sideBName: "Canada",
      holderSide: opts.holderSide ?? "b",
      total: t.liveTotal,
      decided: opts.decided,
    }).state;
  };

  it("planned 32, only 8 created, USA 4–0 up → NOT clinched (28 planned points still available)", () => {
    // Old bug: with created-only total (8, win line 4.5) USA at 4 looks nearly
    // there / the holder looks safe. With liveTotal 32 (win line 16.5) it's early.
    expect(verdict({ createdCount: 8, voidedCount: 0, plannedTotal: 32, pointsA: 4, pointsB: 0, decided: 4 })).toBe("IN_PROGRESS");
  });

  it("planned 8, no planned override, 8 created: holder genuinely safe → HOLDER_RETAINS", () => {
    // Canada holds; USA 3, Canada 4, 7 decided, 1 live → USA max 3+1=4 < 4.5.
    expect(verdict({ createdCount: 8, voidedCount: 0, plannedTotal: null, pointsA: 3, pointsB: 4, decided: 7 })).toBe("HOLDER_RETAINS");
  });

  it("planned 8: challenger reaches the win line → CHALLENGER_WINS", () => {
    expect(verdict({ createdCount: 8, voidedCount: 0, plannedTotal: 8, pointsA: 4.5, pointsB: 3.5, decided: 8 })).toBe("CHALLENGER_WINS");
  });
});
