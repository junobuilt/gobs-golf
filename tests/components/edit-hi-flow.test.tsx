// @vitest-environment jsdom
//
// Phase D.2 — Edit HI modal + HI verification chip on the scorecard.
//
// Covers:
//   - Edit HI link only renders in ?edit=1 mode.
//   - Save writes handicap_index_snapshot + course_handicap + hi_verified_at
//     to the right round_player row (and only that row).
//   - course_handicap is recomputed (negative control: fixture seeds a
//     stale CH that would not match the new HI; test fails if recompute
//     is removed).
//   - HI verification chip renders when created_at > played_on + 1 day
//     AND hi_verified_at IS NULL.
//   - Negative control: chip does NOT render when hi_verified_at is set.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { FakeSupabase, type FakeData } from "./fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
const searchParamsRef = vi.hoisted(() => ({ current: new URLSearchParams("") }));

vi.mock("@/lib/supabase", () => ({
  get supabase() { return fakeRef.current; },
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => searchParamsRef.current,
  usePathname: () => "/round/1/scorecard",
}));

import ScorecardPage from "@/app/round/[id]/scorecard/page";
import { resetWriteQueueForTesting } from "@/lib/writeQueue";

// Reopened round (is_complete=false, was_finalized=true). One player added
// long after played_on (H.5-import shape) with a STALE course_handicap of
// 99 — any real recompute on save will overwrite it. The other player is
// on round day with a freshly-verified HI.
function buildReopenedRoundSeed(): FakeData {
  const holes: any[] = [];
  for (let n = 1; n <= 18; n++) {
    holes.push({
      id: holes.length + 1,
      tee_id: 1,
      hole_number: n,
      par: 4,
      yardage: 350,
      stroke_index: n,
    });
  }
  return {
    rounds: [
      {
        id: 1,
        played_on: "2026-01-15",
        course_id: 1,
        is_complete: false,
        was_finalized: true,
        format: "2_ball",
        format_config: {
          basis: "net",
          best_n: 2,
          override_holes: [],
          submitted_teams: [],
        },
        format_locked_at: "2026-01-15T00:00:00Z",
        created_at: "2026-01-15T00:00:00Z",
      },
    ],
    tees: [
      { id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 },
    ],
    holes,
    round_players: [
      // Player 101: added on round day, snapshot HI 10. STALE CH = 99
      // (real CH from slope 113 / CR 72 / par 72 with HI 10 should be 10).
      // hi_verified_at = null but created_at = played_on → chip predicate
      // fails (not > played_on + 1 day), so no chip should render for
      // this row even without verification.
      {
        id: 101,
        round_id: 1,
        player_id: 301,
        tee_id: 1,
        team_number: 1,
        course_handicap: 99,
        handicap_index_snapshot: 10,
        created_at: "2026-01-15T10:00:00Z",
        hi_verified_at: null,
      },
      // Player 102: H.5-import shape — created_at much later than
      // played_on, hi_verified_at null. Should show the verify chip.
      {
        id: 102,
        round_id: 1,
        player_id: 302,
        tee_id: 1,
        team_number: 1,
        course_handicap: 99,
        handicap_index_snapshot: 12,
        created_at: "2026-05-25T10:00:00Z",
        hi_verified_at: null,
      },
      // Player 103: H.5-shape created_at but already verified — chip
      // must NOT render (negative control on the verified branch).
      {
        id: 103,
        round_id: 1,
        player_id: 303,
        tee_id: 1,
        team_number: 1,
        course_handicap: 14,
        handicap_index_snapshot: 14,
        created_at: "2026-05-25T10:00:00Z",
        hi_verified_at: "2026-05-26T08:00:00Z",
      },
    ],
    players: [
      { id: 301, full_name: "Alice A", display_name: "Alice A", handicap_index: 10, preferred_tee_id: 1 },
      { id: 302, full_name: "Bob B",   display_name: "Bob B",   handicap_index: 12, preferred_tee_id: 1 },
      { id: 303, full_name: "Carol C", display_name: "Carol C", handicap_index: 14, preferred_tee_id: 1 },
    ],
    scores: [],
  };
}

async function flushMicrotasks(rounds = 8) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
async function settle(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await act(async () => { await flushMicrotasks(); });
}

async function renderAndLoad(search: string) {
  searchParamsRef.current = new URLSearchParams(search);
  Object.defineProperty(window, "location", {
    value: new URL(`http://localhost/round/1/scorecard?${search}`),
    writable: true,
  });
  render(<ScorecardPage />);
  await settle(10);
  await settle(0);
}

beforeEach(() => {
  globalThis.localStorage.clear();
  resetWriteQueueForTesting();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  resetWriteQueueForTesting();
  vi.useRealTimers();
});

describe("Scorecard — Edit HI affordance gating", () => {
  it("Edit HI link renders for every player when ?edit=1 is set", async () => {
    fakeRef.current = new FakeSupabase(buildReopenedRoundSeed());
    await renderAndLoad("team=1&admin=1&edit=1");
    expect(screen.getByTestId("hi-edit-link-101")).toBeInTheDocument();
    expect(screen.getByTestId("hi-edit-link-102")).toBeInTheDocument();
    expect(screen.getByTestId("hi-edit-link-103")).toBeInTheDocument();
  });

  it("Edit HI link does NOT render without ?edit=1", async () => {
    fakeRef.current = new FakeSupabase(buildReopenedRoundSeed());
    await renderAndLoad("team=1&admin=1");
    expect(screen.queryByTestId("hi-edit-link-101")).toBeNull();
    expect(screen.queryByTestId("hi-edit-link-102")).toBeNull();
  });
});

describe("Scorecard — HI verification chip", () => {
  it("renders chip ONLY on rows where created_at > played_on + 1 day AND hi_verified_at is null", async () => {
    fakeRef.current = new FakeSupabase(buildReopenedRoundSeed());
    await renderAndLoad("team=1&admin=1&edit=1");

    // Player 102: H.5-shape + unverified → chip renders
    expect(screen.getByTestId("hi-verify-chip-102")).toBeInTheDocument();
    // Player 101: created same day as played_on → predicate fails, no chip
    expect(screen.queryByTestId("hi-verify-chip-101")).toBeNull();
    // Player 103: H.5-shape BUT verified → negative control, no chip
    expect(screen.queryByTestId("hi-verify-chip-103")).toBeNull();
  });

  it("does not render any chip without ?edit=1", async () => {
    fakeRef.current = new FakeSupabase(buildReopenedRoundSeed());
    await renderAndLoad("team=1&admin=1");
    expect(screen.queryByTestId("hi-verify-chip-102")).toBeNull();
  });
});

describe("Scorecard — Edit HI save", () => {
  it("opens modal with prefilled snapshot value", async () => {
    fakeRef.current = new FakeSupabase(buildReopenedRoundSeed());
    await renderAndLoad("team=1&admin=1&edit=1");

    await act(async () => {
      fireEvent.click(screen.getByTestId("hi-edit-link-102"));
    });
    expect(screen.getByTestId("edit-hi-modal")).toBeInTheDocument();
    const input = screen.getByTestId("edit-hi-input") as HTMLInputElement;
    expect(input.value).toBe("12");
  });

  it("Save writes handicap_index_snapshot + hi_verified_at + recomputed CH (negative control: stale CH=99)", async () => {
    fakeRef.current = new FakeSupabase(buildReopenedRoundSeed());
    await renderAndLoad("team=1&admin=1&edit=1");
    // Mount-time LT1 self-heal writes course_handicap for all 3 players
    // (the fixture seeds stale CH=99). Reset the writes log so this test
    // observes only the Edit HI save.
    await settle(20);
    fakeRef.current.reset();

    await act(async () => {
      fireEvent.click(screen.getByTestId("hi-edit-link-102"));
    });
    const input = screen.getByTestId("edit-hi-input") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "8" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("edit-hi-save"));
    });
    await settle(20);

    // Find the round_players update for id=102.
    const updates = fakeRef.current.writes.filter(
      (w) => w.type === "update" && w.table === "round_players",
    );
    const update102 = updates.find(
      (w: any) => w.filters.some((f: any) => f[0] === "id" && f[1] === 102),
    ) as any;
    expect(update102).toBeDefined();
    expect(update102.payload.handicap_index_snapshot).toBe(8);
    expect(update102.payload.hi_verified_at).toBeTruthy();
    // Negative control: fixture CH = 99, real CH for HI 8 on slope 113/
    // CR 72/par 72 = 8 * (113/113) + (72-72) = 8. If the recompute were
    // removed from saveEditHi, this assertion would fail (payload would
    // either omit course_handicap or carry the stale 99).
    expect(update102.payload.course_handicap).toBe(8);
  });

  it("Save does NOT update players table or other round_players rows", async () => {
    fakeRef.current = new FakeSupabase(buildReopenedRoundSeed());
    await renderAndLoad("team=1&admin=1&edit=1");
    await settle(20);
    fakeRef.current.reset();

    await act(async () => {
      fireEvent.click(screen.getByTestId("hi-edit-link-102"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("edit-hi-save"));
    });
    await settle(20);

    const playerWrites = fakeRef.current.writes.filter((w) => w.table === "players");
    expect(playerWrites).toHaveLength(0);

    const rpWrites = fakeRef.current.writes.filter(
      (w) => w.type === "update" && w.table === "round_players",
    ) as any[];
    // Only one round_player updated (id=102).
    expect(rpWrites).toHaveLength(1);
    expect(rpWrites[0].filters.some((f: any) => f[0] === "id" && f[1] === 102)).toBe(true);
  });

  it("Verify button writes the existing snapshot value AND sets hi_verified_at", async () => {
    fakeRef.current = new FakeSupabase(buildReopenedRoundSeed());
    await renderAndLoad("team=1&admin=1&edit=1");
    await settle(20);
    fakeRef.current.reset();

    await act(async () => {
      fireEvent.click(screen.getByTestId("hi-edit-link-102"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("edit-hi-verify"));
    });
    await settle(20);

    const updates = fakeRef.current.writes.filter(
      (w) => w.type === "update" && w.table === "round_players",
    ) as any[];
    expect(updates).toHaveLength(1);
    // Saved the prefilled value unchanged (12) and stamped the timestamp.
    expect(updates[0].payload.handicap_index_snapshot).toBe(12);
    expect(updates[0].payload.hi_verified_at).toBeTruthy();
  });
});
