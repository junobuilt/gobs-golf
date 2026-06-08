// @vitest-environment jsdom
/**
 * Wave 1A Bug #2 + Bug #3 — per-player scorecard row labels.
 *
 * Bug #2: ball labels must be sequential 1..N, each number used once, where N
 * is the number of balls counting on THIS hole (3 on a normal 3-Ball hole; the
 * full team on an "all scores count" override hole). The old code stamped
 * "Ball 2" on every counting ball past the first (observed: three Ball 2s, no
 * Ball 3). Order is by net rank (best = Ball 1), ties broken by roster order.
 *
 * Bug #3: Net must always render on a player row when a score exists, even when
 * net === gross (the player gets no stroke on this hole).
 *
 * All players are seeded scratch (CH 0 via HI 2 on slope 120 / rating 70 / par
 * 72 → computeCourseHandicap = 0) so net === gross and the LT1 self-heal does
 * not fire a write that would change strokes mid-test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FakeSupabase, buildSeed, type FakeData } from "./fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "1" }),
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/round/1/scorecard",
}));

import ScorecardPage from "@/app/round/[id]/scorecard/page";
import { resetWriteQueueForTesting } from "@/lib/writeQueue";

// Make every seeded player scratch (CH 0) with a matching HI so the self-heal
// is a no-op, then apply the requested per-hole-1 gross scores.
function scratchSeed(
  scoresH1: number[],
  opts: { format: string; best_n: number; override_holes: number[]; players: number },
): FakeData {
  const rpIds = [101, 102, 103, 104].slice(0, opts.players);
  const seed = buildSeed({
    preExistingScores: rpIds.map((rpId, i) => ({
      round_player_id: rpId,
      hole_number: 1,
      strokes: scoresH1[i],
    })),
  });
  seed.rounds[0].format = opts.format;
  seed.rounds[0].format_config = {
    basis: "net",
    best_n: opts.best_n,
    override_holes: opts.override_holes,
  };
  // buildSeed ships 3 players/rps; add a 4th when asked.
  if (opts.players === 4) {
    seed.round_players.push({ id: 104, round_id: 1, player_id: 204, tee_id: 1, team_number: 1, course_handicap: 0 });
    seed.players.push({ id: 204, full_name: "Dave D", display_name: "Dave D", handicap_index: 2, preferred_tee_id: 1 });
  }
  seed.round_players = seed.round_players.slice(0, opts.players);
  seed.round_players.forEach(rp => { rp.course_handicap = 0; });
  seed.players.forEach(p => { p.handicap_index = 2; }); // → computeCourseHandicap = 0
  return seed;
}

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: new URL("http://localhost/round/1/scorecard"),
    writable: true,
  });
  routerPush.mockReset();
  globalThis.localStorage.clear();
  resetWriteQueueForTesting();
});

afterEach(() => {
  cleanup();
  resetWriteQueueForTesting();
});

describe("Scorecard — Bug #2 ball labels (sequential 1..N, no dup/skip)", () => {
  it("3-Ball hole with a two-way net tie → Ball 1 / Ball 2 / Ball 3", async () => {
    // Nets (CH 0): Alice 4, Bob 4 (tie), Carol 5. Best-3-of-3 → all count.
    // Order by net then roster: Alice=1, Bob=2, Carol=3.
    fakeRef.current = new FakeSupabase(
      scratchSeed([4, 4, 5], { format: "3_ball", best_n: 3, override_holes: [], players: 3 }),
    );
    render(<ScorecardPage />);
    await screen.findByText("Hole 1");

    expect(screen.getByText("Ball 1")).toBeInTheDocument();
    expect(screen.getByText("Ball 3")).toBeInTheDocument();
    // The bug produced a duplicate "Ball 2" and no "Ball 3".
    expect(screen.getAllByText("Ball 2")).toHaveLength(1);
    expect(screen.queryByText("Ball 4")).toBeNull();
  });

  it("override hole with 4 counting balls → Ball 1 through Ball 4", async () => {
    // override_holes [1] → all 4 scorers count regardless of best_n.
    // Distinct nets 3/4/5/6 → Ball 1..4 in net order.
    fakeRef.current = new FakeSupabase(
      scratchSeed([3, 4, 5, 6], { format: "3_ball", best_n: 3, override_holes: [1], players: 4 }),
    );
    render(<ScorecardPage />);
    await screen.findByText("Hole 1");

    expect(screen.getByText("Ball 1")).toBeInTheDocument();
    expect(screen.getByText("Ball 2")).toBeInTheDocument();
    expect(screen.getByText("Ball 3")).toBeInTheDocument();
    expect(screen.getByText("Ball 4")).toBeInTheDocument();
    // Each number used exactly once.
    expect(screen.getAllByText("Ball 2")).toHaveLength(1);
  });
});

describe("Scorecard — Bug #3 Net always renders (even when net === gross)", () => {
  it("shows Net on a hole where the player receives no stroke", async () => {
    // Scratch players, gross 4 on hole 1 → net 4 (no stroke). Net must render.
    fakeRef.current = new FakeSupabase(
      scratchSeed([4, 4, 4], { format: "2_ball", best_n: 2, override_holes: [], players: 3 }),
    );
    render(<ScorecardPage />);
    await screen.findByText("Hole 1");

    // At least one player row shows "Net: 4" (equal to gross). The pre-fix
    // `net !== gross` guard suppressed it entirely.
    expect(screen.getAllByText("Net: 4").length).toBeGreaterThanOrEqual(1);
  });
});
