// @vitest-environment jsdom
//
// RecommendTeamsModal — two targeted behavioral tests:
//
// 1. Apply button wiring (Task 1 regression guard)
//    a. hasExistingTeams=false → Apply fires onApply directly, no DangerModal
//    b. hasExistingTeams=true  → DangerModal appears at zIndex 1200 (above the
//       1100 modal overlay), confirm fires onApply, cancel leaves it un-called
//
// 2. Preview order == applied order (Task 2 regression guard)
//    After generate(), result.teams is sorted ascending by roster size BEFORE
//    setResult() is called, so both the preview cards and the onApply payload
//    carry the same sorted order. Test asserts preview teams are non-decreasing
//    in size AND that onApply receives the identical sequence.
//
// Mocks:
//   @/lib/supabase          → tees SELECT returns a single tee (id=4)
//   @/lib/playedWith/compute → fetchPlayedWithRows returns empty rows;
//                              computePairMatrix returns () => 0

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import React from "react";

// ── Supabase mock ─────────────────────────────────────────────────────────────
// Handles: supabase.from("tees").select(...).then(cb)
// The builder is synchronously chainable and thenable.
const MOCK_TEES = [{ id: 4, slope_rating: 120, course_rating: 67.6, par: 72 }];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        then: (resolve: (v: { data: typeof MOCK_TEES; error: null }) => unknown) =>
          Promise.resolve().then(() => resolve({ data: MOCK_TEES, error: null })),
      }),
    }),
  },
}));

// ── playedWith mock ───────────────────────────────────────────────────────────
vi.mock("@/lib/playedWith/compute", () => ({
  fetchPlayedWithRows: vi.fn().mockResolvedValue({ rpRows: [] }),
  computePairMatrix: vi.fn().mockReturnValue(() => 0),
}));

import RecommendTeamsModal from "@/components/admin/RecommendTeamsModal";
import type { Player } from "@/app/admin/page";
import type { RecommendResult } from "@/lib/teamRecommend";

// ── Async helper ──────────────────────────────────────────────────────────────
// Flushes pending Promise microtasks so fire-and-forget async functions
// (like generate()) settle before we assert. Pattern from admin-played-with test.
async function flush(n = 20) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

// 14 players with distinct CHs so the engine produces exactly 4 teams.
// partitionSizes(14, 4) = [4, 4, 3, 3] (larger-first from the engine).
// After ascending sort in generate(): [3, 3, 4, 4].
// Team 1 and Team 2 in the preview should have 3 players each.
function makeRoster(): Player[] {
  return Array.from({ length: 14 }, (_, i) => ({
    id: i + 1,
    full_name: `Player ${i + 1}`,
    display_name: `P${i + 1}`,
    handicap_index: i + 5,
    is_active: true,
    preferred_tee_id: 4,
  }));
}

function makePlayerRpInfo(roster: Player[]) {
  return Object.fromEntries(
    roster.map((p, i) => [p.id, { courseHandicap: i + 5, teeId: 4 }]),
  );
}

// ── Shared render + generate helper ───────────────────────────────────────────

function renderModal(opts: {
  hasExistingTeams: boolean;
  onApply: (r: RecommendResult) => void;
  onClose?: () => void;
}) {
  const roster = makeRoster();
  return render(
    <RecommendTeamsModal
      activeSeasonId={1}
      activeSeason={null}
      roster={roster}
      playerRpInfo={makePlayerRpInfo(roster)}
      hasExistingTeams={opts.hasExistingTeams}
      roundId={42}
      onApply={opts.onApply}
      onClose={opts.onClose ?? vi.fn()}
    />,
  );
}

// Flush the initial tees load, click Generate Teams, flush generate() completion.
// handleGenerate() calls generate() without await so we need explicit flushing.
async function clickGenerate() {
  await act(async () => { await flush(); }); // settle tees useEffect
  await act(async () => {
    fireEvent.click(screen.getByText("Generate Teams"));
    await flush(); // resolve fetchPlayedWithRows + setResult state update
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RecommendTeamsModal — Apply button wiring", () => {
  afterEach(cleanup);

  it("hasExistingTeams=false: Apply calls onApply directly without a DangerModal", async () => {
    const onApply = vi.fn();
    renderModal({ hasExistingTeams: false, onApply });

    await clickGenerate();

    // "Apply Teams →" button must appear after generate.
    expect(screen.getByText("Apply Teams →")).toBeTruthy();
    // No danger modal yet.
    expect(screen.queryByText("Replace current teams?")).toBeNull();

    fireEvent.click(screen.getByText("Apply Teams →"));

    // onApply fires immediately — no confirmation step.
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Replace current teams?")).toBeNull();
  });

  it("hasExistingTeams=true: Apply opens DangerModal at zIndex 1200; Cancel does not fire onApply", async () => {
    const onApply = vi.fn();
    renderModal({ hasExistingTeams: true, onApply });

    await clickGenerate();

    fireEvent.click(screen.getByText("Apply Teams →"));

    // DangerModal must appear.
    expect(screen.getByText("Replace current teams?")).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();

    // The DangerModal's full-screen backdrop must carry zIndex 1200 so it
    // clears the RecommendTeamsModal's own 1100 overlay. The backdrop is the
    // fixed-position grandparent of the modal title.
    const dangerTitle = screen.getByText("Replace current teams?");
    // DangerModal DOM: backdrop > inner-box > [icon div, h2 title, ...]
    const innerBox = dangerTitle.parentElement as HTMLElement;
    const backdrop = innerBox.parentElement as HTMLElement;
    expect(backdrop.style.zIndex).toBe("1200");

    // Cancel → DangerModal dismissed, onApply never called.
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Replace current teams?")).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("hasExistingTeams=true: confirming DangerModal after the 1.5 s delay calls onApply", async () => {
    vi.useFakeTimers();
    const onApply = vi.fn();
    renderModal({ hasExistingTeams: true, onApply });

    // Tees load and generate with fake timers active — Promise microtasks still
    // resolve normally since vi.useFakeTimers() doesn't fake Promise.
    await act(async () => { await flush(); }); // tees
    await act(async () => {
      fireEvent.click(screen.getByText("Generate Teams"));
      await flush();
    });

    fireEvent.click(screen.getByText("Apply Teams →"));
    expect(screen.getByText("Replace current teams?")).toBeTruthy();
    expect(screen.getByText("Wait…")).toBeTruthy(); // confirm still disabled

    // Advance past the 1.5 s guard.
    await act(async () => { vi.advanceTimersByTime(1600); });

    expect(screen.getByText("Replace")).toBeTruthy(); // now enabled
    fireEvent.click(screen.getByText("Replace"));

    expect(onApply).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("RecommendTeamsModal — preview order == applied order", () => {
  afterEach(cleanup);

  it("teams sorted ascending by size at generate time; preview and onApply carry the same order", async () => {
    const onApply = vi.fn();
    renderModal({ hasExistingTeams: false, onApply });

    await clickGenerate();

    // ── Preview: team cards must be in non-decreasing size order ─────────────
    // Each team card has a header span "Team N" and a player-names div with
    // display_names like "P1, P2, P3". Count P-token occurrences per card.
    const teamLabels = screen
      .getAllByText(/^Team \d+$/)
      // SeasonToggle or other components don't emit "Team N" text, but filter
      // to span/div elements to be safe.
      .filter((el) => ["SPAN", "DIV"].includes(el.tagName));

    // The label is inside the card; its grandparent is the card container.
    const previewSizes = teamLabels.map((label) => {
      // DOM: card-div > header-div > "Team N" span
      // Go up two levels to reach the card div whose text includes the player names.
      const card = label.parentElement?.parentElement;
      const text = card?.textContent ?? "";
      // Player display_names are "P1", "P2", … — count those tokens.
      return (text.match(/P\d+/g) ?? []).length;
    });

    // Non-decreasing — smaller teams first.
    for (let i = 0; i < previewSizes.length - 1; i++) {
      expect(previewSizes[i]).toBeLessThanOrEqual(previewSizes[i + 1]);
    }

    // Engine produces [4,4,3,3]; sort → [3,3,4,4]. First two cards = 3 players.
    expect(previewSizes.slice(0, 2)).toEqual([3, 3]);
    expect(previewSizes.slice(2)).toEqual([4, 4]);

    // ── Applied payload must match preview exactly ────────────────────────────
    fireEvent.click(screen.getByText("Apply Teams →"));
    expect(onApply).toHaveBeenCalledTimes(1);

    const appliedResult: RecommendResult = onApply.mock.calls[0][0];
    const appliedSizes = appliedResult.teams.map((t) => t.playerIds.length);

    expect(appliedSizes).toEqual(previewSizes);
  });
});
