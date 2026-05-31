// @vitest-environment jsdom
/**
 * A9 — tie-prompt / manual ball-override removed from the live scorecard.
 *
 * In best-N formats a three-way net tie used to render a "Tied for Ball …"
 * banner and a "Tap a player card to override which balls count" footer, and
 * swapped the BALL pill for a "Tied" pill. The 60–80yo league found this
 * confusing, so the system now silently auto-picks the N best net balls.
 *
 * These tests pin that behavior: on a genuine three-way tie in a 2-Ball round
 * neither the banner nor the footer renders, and the read-only BALL 1 / BALL 2
 * pills still show (reflecting the deterministic best-N auto-pick).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FakeSupabase, buildSeed } from "./fake-supabase";

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

/**
 * Three-way net tie on hole 1: all three players (CH 9/11/6, SI 1 → 1 stroke
 * each) score gross 5 → net 4. Best-2 must still resolve deterministically to
 * the first two players in roster order (Alice, Bob).
 */
function buildTieSeed() {
  const seed = buildSeed({
    preExistingScores: [
      { round_player_id: 101, hole_number: 1, strokes: 5 },
      { round_player_id: 102, hole_number: 1, strokes: 5 },
      { round_player_id: 103, hole_number: 1, strokes: 5 },
    ],
  });
  // Match computed course handicaps so the LT1 self-heal doesn't fire writes.
  seed.round_players[0].course_handicap = 9; // Alice HI=10
  seed.round_players[1].course_handicap = 11; // Bob HI=12
  seed.round_players[2].course_handicap = 6; // Carol HI=8
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

describe("Scorecard — A9 tie has no override prompt (best-N)", () => {
  it("does not render the tie banner or override footer on a three-way tie", async () => {
    fakeRef.current = new FakeSupabase(buildTieSeed());
    render(<ScorecardPage />);
    await screen.findByText("Hole 1");

    // Banner + footer copy both contained "override which balls count".
    expect(screen.queryByText(/override which balls count/i)).toBeNull();
    // Footer hint copy.
    expect(screen.queryByText(/tap a player card/i)).toBeNull();
    // The interactive "Tied" pill is gone.
    expect(screen.queryByText(/^Tied$/)).toBeNull();
  });

  it("still shows read-only BALL 1 / BALL 2 pills (auto-pick) on a tie", async () => {
    fakeRef.current = new FakeSupabase(buildTieSeed());
    render(<ScorecardPage />);
    await screen.findByText("Hole 1");

    // Best-2 auto-pick resolves to roster order: Alice = Ball 1, Bob = Ball 2.
    expect(screen.getByText("Ball 1")).toBeInTheDocument();
    expect(screen.getByText("Ball 2")).toBeInTheDocument();
  });
});
