// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import React from "react";
import ManageTeamSheet from "@/components/teamFormation/ManageTeamSheet";
import type { RoundPlayer } from "@/lib/teamFormation/smartJoin";
import type { Player } from "@/app/admin/page";

// ── Mock useIsMobile so tests run in a consistent "mobile=false" environment ──
vi.mock("@/lib/useIsMobile", () => ({ useIsMobile: () => false }));

// ── Page-level test setup (score-exists hides Manage Team button) ─────────────
const fakeRef = vi.hoisted(() => ({ current: null as any }));

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

vi.mock("@/lib/writeQueue", async () => {
  const actual = await vi.importActual<typeof import("@/lib/writeQueue")>("@/lib/writeQueue");
  return actual;
});

afterEach(() => cleanup());

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeRp(id: number, name: string, playerId = id * 100): RoundPlayer {
  return {
    id,
    player_id: playerId,
    team_number: 1,
    players: { full_name: name, display_name: name },
  };
}

const rp1 = makeRp(1, "Alice");
const rp2 = makeRp(2, "Bob");
const rp3 = makeRp(3, "Carol");
const rp4 = makeRp(4, "Dave");

const noPlayers: Player[] = [];

// ── ManageTeamSheet unit tests ────────────────────────────────────────────────

describe("ManageTeamSheet", () => {
  it("renders all 4 members, each with a × remove button", () => {
    render(
      <ManageTeamSheet
        teamNumber={1}
        teamRoster={[rp1, rp2, rp3, rp4]}
        unassignedActivePlayers={noPlayers}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
    expect(screen.getByText("Dave")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove Alice")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove Bob")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove Carol")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove Dave")).toBeInTheDocument();
  });

  it("× tap calls onRemove with the correct roundPlayerId", () => {
    const onRemove = vi.fn();
    render(
      <ManageTeamSheet
        teamNumber={1}
        teamRoster={[rp1, rp2, rp3, rp4]}
        unassignedActivePlayers={noPlayers}
        onRemove={onRemove}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Remove Bob"));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledWith(rp2.id);
  });

  it("re-render with updated roster restores removed member (simulates undo)", () => {
    const { rerender } = render(
      <ManageTeamSheet
        teamNumber={1}
        teamRoster={[rp1, rp2, rp3, rp4]}
        unassignedActivePlayers={noPlayers}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Simulate optimistic remove (parent removes Bob from roster prop)
    rerender(
      <ManageTeamSheet
        teamNumber={1}
        teamRoster={[rp1, rp3, rp4]}
        unassignedActivePlayers={noPlayers}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();

    // Simulate undo (parent restores Bob to roster prop)
    rerender(
      <ManageTeamSheet
        teamNumber={1}
        teamRoster={[rp1, rp2, rp3, rp4]}
        unassignedActivePlayers={noPlayers}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("+ Add player CTA opens PlayerPickerSheet in add_to_team mode", () => {
    const alice: Player = {
      id: 99,
      full_name: "Alice Unassigned",
      display_name: "Alice U",
      handicap_index: null,
      is_active: true,
      preferred_tee_id: null,
    };
    render(
      <ManageTeamSheet
        teamNumber={3}
        teamRoster={[rp1]}
        unassignedActivePlayers={[alice]}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("+ Add player"));
    // PlayerPickerSheet in add_to_team mode shows the team-specific CTA label
    expect(screen.getByRole("button", { name: "Add to Team 3" })).toBeInTheDocument();
    // Unassigned player appears in the list
    expect(screen.getByText("Alice U")).toBeInTheDocument();
  });
});

// ── Page-level: score-exists hides Manage Team button ────────────────────────

describe("Scorecard page — Manage Team visibility", () => {
  // Lazy-import after mocks so the page picks up fakeRef.
  let ScorecardPage: React.ComponentType;
  let buildSeed: typeof import("../fake-supabase").buildSeed;
  let FakeSupabase: typeof import("../fake-supabase").FakeSupabase;
  let resetWriteQueueForTesting: typeof import("@/lib/writeQueue").resetWriteQueueForTesting;

  beforeEach(async () => {
    const fakeModule = await import("../fake-supabase");
    buildSeed = fakeModule.buildSeed;
    FakeSupabase = fakeModule.FakeSupabase;
    const pageModule = await import("@/app/round/[id]/scorecard/page");
    ScorecardPage = pageModule.default;
    const wq = await import("@/lib/writeQueue");
    resetWriteQueueForTesting = wq.resetWriteQueueForTesting;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
    resetWriteQueueForTesting?.();
  });

  function seedWithTeamFilter(
    opts: {
      preExistingScores?: Array<{
        round_player_id: number;
        hole_number: number;
        strokes: number;
      }>;
    } = {},
  ) {
    const seed = buildSeed(opts);
    // Pre-compute course_handicap to avoid LT1 self-heal writes
    seed.round_players[0].course_handicap = 9;
    seed.round_players[1].course_handicap = 11;
    seed.round_players[2].course_handicap = 6;
    fakeRef.current = new FakeSupabase(seed);
  }

  it("Manage Team button is visible before any score is entered", async () => {
    Object.defineProperty(window, "location", {
      value: new URL("http://localhost/round/1/scorecard?team=1"),
      writable: true,
      configurable: true,
    });
    seedWithTeamFilter();
    render(React.createElement(ScorecardPage));
    await screen.findByText("Hole 1");
    expect(screen.getByRole("button", { name: "Manage Team" })).toBeInTheDocument();
  });

  it("Manage Team button is absent once a score exists for the team", async () => {
    Object.defineProperty(window, "location", {
      value: new URL("http://localhost/round/1/scorecard?team=1"),
      writable: true,
      configurable: true,
    });
    seedWithTeamFilter({
      preExistingScores: [{ round_player_id: 101, hole_number: 1, strokes: 4 }],
    });
    render(React.createElement(ScorecardPage));
    await screen.findByText("Hole 1");
    expect(screen.queryByRole("button", { name: "Manage Team" })).not.toBeInTheDocument();
  });

  it("Manage Team button is absent on whole-round view (no ?team= filter)", async () => {
    Object.defineProperty(window, "location", {
      value: new URL("http://localhost/round/1/scorecard"),
      writable: true,
      configurable: true,
    });
    seedWithTeamFilter();
    render(React.createElement(ScorecardPage));
    await screen.findByText("Hole 1");
    expect(screen.queryByRole("button", { name: "Manage Team" })).not.toBeInTheDocument();
  });
});
