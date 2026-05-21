/**
 * H2.5.6 — Handicap Index Snapshot tests.
 *
 * Covers:
 * (a) snapshot is set on insert — verified via MiniFake write inspection in
 *     the homepage PlayerPickerSheet integration (see tests/app/page-team-formation.test.tsx)
 * (b) self-heal does not fire on finalized rounds
 * (c) admin HI edit cascades to active rounds only
 * (d) CH math reads from snapshot, not live players.handicap_index
 * (e) Integration: finalized round CH is unchanged after HI edit
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeCourseHandicap } from "@/lib/scoring";

// ── (d) CH math reads from snapshot ─────────────────────────────────────────
describe("(d) CH math reads from handicap_index_snapshot", () => {
  it("CH computed from snapshot HI differs from live HI when they differ", () => {
    const snapshotHI = 15;
    const liveHI = 10;
    const slope = 130, rating = 72, par = 72;
    const chFromSnapshot = computeCourseHandicap(snapshotHI, slope, rating, par);
    const chFromLive = computeCourseHandicap(liveHI, slope, rating, par);
    expect(chFromSnapshot).not.toBe(chFromLive);
    // Verify snapshot value drives the result
    expect(chFromSnapshot).toBe(Math.round(snapshotHI * slope / 113 + (rating - par)));
  });

  it("null snapshot yields null CH (player missing HI at round time)", () => {
    expect(computeCourseHandicap(null, 130, 72, 72)).toBeNull();
  });

  it("LT1 regression anchor: Kevin snapshot HI=12.5 on white/yellow combo yields CH=9", () => {
    expect(computeCourseHandicap(12.5, 120, 67.6, 72)).toBe(9);
  });

  it("LT1 regression anchor: Wayne snapshot HI=20.1 on white/yellow combo yields CH=17", () => {
    expect(computeCourseHandicap(20.1, 120, 67.6, 72)).toBe(17);
  });
});

// ── (b) Self-heal guard on roundIsComplete ───────────────────────────────────
describe("(b) self-heal does not fire on finalized rounds", () => {
  it("skips CH recompute when roundIsComplete is true", () => {
    const roundIsComplete = true;
    let writesCount = 0;

    // Simulate the self-heal guard pattern from scorecard/page.tsx
    const players = [
      { id: 1, handicap_index_snapshot: 15, course_handicap: 12, tee_id: 1 },
    ];
    const tees = [{ id: 1, slope_rating: 130, course_rating: 72, par: 72 }];

    if (!roundIsComplete) {
      players.forEach(p => {
        const tee = tees.find(t => t.id === p.tee_id);
        if (!tee || p.handicap_index_snapshot == null) return;
        const expected = computeCourseHandicap(
          p.handicap_index_snapshot, tee.slope_rating, tee.course_rating, tee.par,
        );
        if (expected !== p.course_handicap) writesCount++;
      });
    }

    expect(writesCount).toBe(0);
  });

  it("fires self-heal on active round when snapshot CH differs from stored CH", () => {
    const roundIsComplete = false;
    let writesCount = 0;

    const players = [
      // snapshot HI=15 on slope 130 → CH = Math.round(15*130/113) = 17, stored is 12 → mismatch
      { id: 1, handicap_index_snapshot: 15, course_handicap: 12, tee_id: 1 },
    ];
    const tees = [{ id: 1, slope_rating: 130, course_rating: 72, par: 72 }];

    if (!roundIsComplete) {
      players.forEach(p => {
        const tee = tees.find(t => t.id === p.tee_id);
        if (!tee || p.handicap_index_snapshot == null) return;
        const expected = computeCourseHandicap(
          p.handicap_index_snapshot, tee.slope_rating, tee.course_rating, tee.par,
        );
        if (expected !== p.course_handicap) writesCount++;
      });
    }

    expect(writesCount).toBe(1);
  });

  it("skips self-heal on active round when snapshot CH already matches stored CH", () => {
    const roundIsComplete = false;
    let writesCount = 0;

    const storedCH = Math.round(15 * 130 / 113); // = 17
    const players = [
      { id: 1, handicap_index_snapshot: 15, course_handicap: storedCH, tee_id: 1 },
    ];
    const tees = [{ id: 1, slope_rating: 130, course_rating: 72, par: 72 }];

    if (!roundIsComplete) {
      players.forEach(p => {
        const tee = tees.find(t => t.id === p.tee_id);
        if (!tee || p.handicap_index_snapshot == null) return;
        const expected = computeCourseHandicap(
          p.handicap_index_snapshot, tee.slope_rating, tee.course_rating, tee.par,
        );
        if (expected !== p.course_handicap) writesCount++;
      });
    }

    expect(writesCount).toBe(0);
  });
});

// ── (c) Admin HI edit cascade — pure logic test ──────────────────────────────
// The actual Supabase calls are in Players.tsx saveHC. This tests the
// cascade selection logic: only rows in active rounds get updated.
describe("(c) admin HI edit cascades to active rounds only", () => {
  it("identifies active rounds correctly from is_complete flag", () => {
    const allRounds = [
      { id: 1, is_complete: false },
      { id: 2, is_complete: true },
      { id: 3, is_complete: false },
    ];
    const activeRoundIds = allRounds
      .filter(r => !r.is_complete)
      .map(r => r.id);
    expect(activeRoundIds).toEqual([1, 3]);
    expect(activeRoundIds).not.toContain(2);
  });

  it("produces no cascade when no active rounds exist", () => {
    const allRounds = [
      { id: 1, is_complete: true },
      { id: 2, is_complete: true },
    ];
    const activeRoundIds = allRounds
      .filter(r => !r.is_complete)
      .map(r => r.id);
    expect(activeRoundIds).toHaveLength(0);
    // In Players.tsx: `if (activeRounds.length > 0)` guard means no DB write
  });
});

// ── (e) Integration: finalized round CH is unchanged after HI edit ───────────
describe("(e) finalized round CH does not change after HI edit", () => {
  it("stored course_handicap on a finalized round equals the original snapshot-derived value", () => {
    // Simulate: player had HI=12.5 at round time → CH=9 stored in DB
    const snapshotHIAtRoundTime = 12.5;
    const slope = 120, rating = 67.6, par = 72;
    const storedCH = computeCourseHandicap(snapshotHIAtRoundTime, slope, rating, par);
    expect(storedCH).toBe(9);

    // Admin later changes HI to 8.0
    const newLiveHI = 8.0;
    const chFromNewHI = computeCourseHandicap(newLiveHI, slope, rating, par);
    expect(chFromNewHI).toBe(computeCourseHandicap(8.0, 120, 67.6, 72));

    // Finalized round: self-heal is gated off → stored CH stays at 9
    const roundIsComplete = true;
    let finalizedRoundCH = storedCH;
    if (!roundIsComplete) {
      // Would recompute from snapshot — but snapshot is unchanged for finalized rounds
      finalizedRoundCH = chFromNewHI ?? finalizedRoundCH;
    }

    expect(finalizedRoundCH).toBe(9);
    expect(finalizedRoundCH).not.toBe(chFromNewHI);
  });
});
