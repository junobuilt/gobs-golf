// @vitest-environment jsdom
/**
 * Read-only scorecard must render a 🎲 pseudo-row for each round-start
 * blind-draw fill on the displayed team, so a viewer sees WHY the team total
 * moved (the drawn player has no roster slot otherwise). Companion to
 * scorecard-blinddraw-total.test.tsx (which pins the headline number); this
 * pins the visible explanation.
 *
 * Each positive test is a negative control: without the render addition the
 * "blind-draw-fill-row" testid / "Blind draw:" label never appears.
 *
 * Dropout fills (hole_range_start > 1) are excluded here — on the scorecard
 * they're already shown merged into the dropped player's own row (fillsByRpId),
 * matching the summary; a separate pseudo-row would duplicate them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, fireEvent, cleanup } from "@testing-library/react";
import { FakeSupabase } from "./fake-supabase";

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
  useSearchParams: () => new URLSearchParams("team=1"),
  usePathname: () => "/round/1/scorecard",
}));

import ScorecardPage from "@/app/round/[id]/scorecard/page";
import { resetWriteQueueForTesting } from "@/lib/writeQueue";

type Bd = { drawn_player_id: number; hole_range_start: number; hole_range_end: number };

// Best Ball round. Team 1 = Alice (short team). Drawn players live on other
// teams. Two active "Ward"s exist so the drawn player's name must disambiguate
// to "Ward C" (proves getDisplayName runs against the full active roster).
function buildSeed(opts: {
  isComplete: boolean;
  blindDraws: Bd[];
  aliceDroppedAfter?: number | null;
}) {
  const holes = [];
  for (let n = 1; n <= 18; n++) {
    holes.push({ id: n, tee_id: 1, hole_number: n, par: 4, yardage: 350, stroke_index: n });
  }
  const scores: any[] = [];
  let sid = 1000;
  const aliceLast = opts.aliceDroppedAfter ?? 18;
  for (let n = 1; n <= aliceLast; n++) {
    scores.push({ id: sid++, round_player_id: 101, hole_number: n, strokes: 5 }); // Alice
  }
  for (let n = 1; n <= 18; n++) {
    scores.push({ id: sid++, round_player_id: 104, hole_number: n, strokes: 3 }); // Ward Carlson
    scores.push({ id: sid++, round_player_id: 105, hole_number: n, strokes: 2 }); // Bob Brown
  }
  return {
    rounds: [
      {
        id: 1,
        played_on: "2026-05-13",
        course_id: 1,
        is_complete: opts.isComplete,
        format: "best_ball",
        format_config: { basis: "net", best_n: 1, override_holes: [], submitted_teams: [] },
        format_locked_at: "2026-05-13T00:00:00Z",
        created_at: "2026-05-13T00:00:00Z",
      },
    ],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes,
    round_players: [
      { id: 101, round_id: 1, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 0, dropped_after_hole: opts.aliceDroppedAfter ?? null },
      { id: 104, round_id: 1, player_id: 204, tee_id: 1, team_number: 2, course_handicap: 0, dropped_after_hole: null },
      { id: 105, round_id: 1, player_id: 205, tee_id: 1, team_number: 3, course_handicap: 0, dropped_after_hole: null },
    ],
    players: [
      { id: 201, full_name: "Alice Anderson", display_name: "Alice", handicap_index: 0, preferred_tee_id: 1, is_active: true },
      { id: 204, full_name: "Ward Carlson", display_name: "Ward", handicap_index: 0, preferred_tee_id: 1, is_active: true },
      { id: 205, full_name: "Bob Brown", display_name: "Bob", handicap_index: 0, preferred_tee_id: 1, is_active: true },
      // Second active "Ward" — never in the round — forces "Ward C" disambiguation.
      { id: 206, full_name: "Ward Smith", display_name: "Ward", handicap_index: 0, preferred_tee_id: 1, is_active: true },
    ],
    scores,
    blind_draws: opts.blindDraws.map((bd, i) => ({
      id: i + 1,
      round_id: 1,
      short_team_number: 1,
      drawn_player_id: bd.drawn_player_id,
      hole_range_start: bd.hole_range_start,
      hole_range_end: bd.hole_range_end,
    })),
  };
}

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: new URL("http://localhost/round/1/scorecard?team=1"),
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

describe("Scorecard read-only — blind-draw 🎲 pseudo-rows", () => {
  it("renders one 🎲 row per round-start fill, with the drawn player's name disambiguated", async () => {
    fakeRef.current = new FakeSupabase(
      buildSeed({ isComplete: true, blindDraws: [{ drawn_player_id: 204, hole_range_start: 1, hole_range_end: 18 }] }) as any,
    );
    render(<ScorecardPage />);

    const row = await screen.findByTestId("blind-draw-fill-row");
    // Name is the disambiguated short form, not the bare first name.
    expect(within(row).getByText("Blind draw: Ward C")).toBeInTheDocument();
    // Exactly one fill row.
    expect(screen.getAllByTestId("blind-draw-fill-row")).toHaveLength(1);

    // Expand → the drawn player's hole-by-hole scores (3 every hole → F9 and
    // B9 subtotals each 27).
    fireEvent.click(within(row).getByLabelText("Expand hole-by-hole"));
    expect(screen.getAllByText("27")).toHaveLength(2);
  });

  it("renders no 🎲 row pre-finalize (no blind_draws rows)", async () => {
    fakeRef.current = new FakeSupabase(buildSeed({ isComplete: false, blindDraws: [] }) as any);
    render(<ScorecardPage />);

    await screen.findByText("Hole 1");
    expect(screen.queryByTestId("blind-draw-fill-row")).toBeNull();
  });

  it("renders no 🎲 row on a finalized round with no blind draws", async () => {
    fakeRef.current = new FakeSupabase(buildSeed({ isComplete: true, blindDraws: [] }) as any);
    render(<ScorecardPage />);

    await screen.findByText("Hole 1");
    expect(screen.queryByTestId("blind-draw-fill-row")).toBeNull();
  });

  it("does NOT add a duplicate pseudo-row for a dropout fill (already merged into the dropped player's row)", async () => {
    fakeRef.current = new FakeSupabase(
      buildSeed({
        isComplete: true,
        aliceDroppedAfter: 9,
        blindDraws: [{ drawn_player_id: 204, hole_range_start: 10, hole_range_end: 18 }],
      }) as any,
    );
    render(<ScorecardPage />);

    await screen.findByText("Hole 1");
    // The dropout fill (range 10–18) is shown via the existing merge, not a
    // standalone pseudo-row.
    expect(screen.queryByTestId("blind-draw-fill-row")).toBeNull();
  });

  it("renders multiple 🎲 rows when a team has multiple round-start fills", async () => {
    fakeRef.current = new FakeSupabase(
      buildSeed({
        isComplete: true,
        blindDraws: [
          { drawn_player_id: 204, hole_range_start: 1, hole_range_end: 18 },
          { drawn_player_id: 205, hole_range_start: 1, hole_range_end: 18 },
        ],
      }) as any,
    );
    render(<ScorecardPage />);

    const rows = await screen.findAllByTestId("blind-draw-fill-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("Blind draw: Ward C")).toBeInTheDocument();
    expect(screen.getByText("Blind draw: Bob B")).toBeInTheDocument();
  });
});
