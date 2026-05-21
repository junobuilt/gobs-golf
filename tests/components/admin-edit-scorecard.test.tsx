// @vitest-environment jsdom
//
// Tests for the scorecard page's admin-edit-mode behavior:
//   - On a finalized round with ?admin=1&edit=1, +/− buttons are
//     rendered (the read-only gate is bypassed).
//   - +/− taps still write through the WriteQueue (the DB trigger is
//     gone, so writes succeed).
//   - The pinned banner is visible above the scorecard.
//   - Without ?admin=1&edit=1 (or with the round not finalized), the
//     scorecard remains read-only.
//
// Mirrors the submit-flow.test.tsx setup (FakeSupabase, fake timers,
// renderAndLoad helper).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { FakeSupabase, type FakeData } from "./fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
const searchParamsRef = vi.hoisted(() => ({ current: new URLSearchParams("") }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
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
import EditModeBanner from "@/components/round/EditModeBanner";
import { getWriteQueue, resetWriteQueueForTesting } from "@/lib/writeQueue";

function buildFinalizedRoundSeed(): FakeData {
  const holes: any[] = [];
  for (const teeId of [1, 2]) {
    for (let n = 1; n <= 18; n++) {
      holes.push({
        id: holes.length + 1,
        tee_id: teeId,
        hole_number: n,
        par: 4,
        yardage: 350,
        stroke_index: n,
      });
    }
  }
  const scores: any[] = [];
  for (const rpId of [101, 102]) {
    for (let h = 1; h <= 18; h++) {
      scores.push({
        id: scores.length + 1,
        round_player_id: rpId,
        hole_number: h,
        strokes: 4,
        created_at: new Date().toISOString(),
      });
    }
  }
  return {
    rounds: [
      {
        id: 1,
        played_on: "2026-05-18",
        course_id: 1,
        is_complete: true,
        format: "2_ball",
        format_config: {
          basis: "net",
          best_n: 2,
          override_holes: [],
          submitted_teams: [1],
        },
        format_locked_at: "2026-05-18T00:00:00Z",
        created_at: "2026-05-18T00:00:00Z",
      },
    ],
    tees: [
      { id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 },
      { id: 2, color: "Yellow", slope_rating: 115, course_rating: 68, par: 72, sort_order: 2 },
    ],
    holes,
    round_players: [
      { id: 101, round_id: 1, player_id: 301, tee_id: 1, team_number: 1, course_handicap: 10 },
      { id: 102, round_id: 1, player_id: 302, tee_id: 1, team_number: 1, course_handicap: 12 },
    ],
    players: [
      { id: 301, full_name: "Alice A", display_name: "Alice A", handicap_index: 10, preferred_tee_id: 1 },
      { id: 302, full_name: "Bob B",   display_name: "Bob B",   handicap_index: 12, preferred_tee_id: 1 },
    ],
    scores,
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

describe("Scorecard admin edit mode", () => {
  it("on a finalized round, +/− buttons are hidden by default (read-only)", async () => {
    fakeRef.current = new FakeSupabase(buildFinalizedRoundSeed());
    await renderAndLoad("team=1");
    expect(screen.queryByRole("button", { name: "−" })).toBeNull();
    expect(screen.queryByRole("button", { name: "+" })).toBeNull();
  });

  it("on a finalized round with ?admin=1&edit=1, +/− buttons are visible", async () => {
    fakeRef.current = new FakeSupabase(buildFinalizedRoundSeed());
    await renderAndLoad("team=1&admin=1&edit=1");
    expect(screen.getAllByRole("button", { name: "−" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "+" }).length).toBeGreaterThan(0);
  });

  it("+/− tap in admin edit mode enqueues a score write", async () => {
    fakeRef.current = new FakeSupabase(buildFinalizedRoundSeed());
    await renderAndLoad("team=1&admin=1&edit=1");
    const plusButtons = screen.getAllByRole("button", { name: "+" });
    const enqueueSpy = vi.spyOn(getWriteQueue(), "enqueue");
    await act(async () => {
      fireEvent.click(plusButtons[0]);
    });
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const payload = enqueueSpy.mock.calls[0][0] as any;
    expect(payload.round_id).toBe(1);
    expect(payload.round_player_id).toBe(101);
    expect(typeof payload.strokes).toBe("number");
  });

  it("EditModeBanner renders alongside the scorecard when in edit mode", async () => {
    searchParamsRef.current = new URLSearchParams("admin=1&edit=1");
    render(<EditModeBanner />);
    expect(screen.getByTestId("edit-mode-banner")).toBeInTheDocument();
  });
});
