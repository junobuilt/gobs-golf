// @vitest-environment jsdom

// F.1 Parts 5 + 6 — RoundResultsView additions:
//   Part 5: expanded player row shows per-round Course Handicap (the allowance-
//           adjusted PLAYING CH, golden value) + GHIN Adjusted total, and OMITS
//           them on dropout rows.
//   Part 6: admin-only "Edit this round" button (present for admin, absent for
//           a player).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import React from "react";

const navRef = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navRef.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navRef.search),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import RoundResultsView from "@/components/round/RoundResultsView";
import type { LoadedRoundResults, PlayerRow, TeamRow } from "@/lib/round/results";
import { rankAndFormatTeams } from "@/lib/leaderboard/rankAndFormat";
import type { Format, FormatConfig } from "@/lib/scoring";

const PAR_18 = Array(18).fill(4);

function player(over: Partial<PlayerRow> & { rpId: number; displayName: string }): PlayerRow {
  return {
    playerId: over.rpId,
    grossTotal: 80,
    netValue: -2,
    netTotal: 70,
    holesPlayed: 18,
    scores: Array(18).fill(4),
    par: PAR_18,
    adjScores: Array(18).fill(4), // sum 72
    strokeAllocation: Array(18).fill(0),
    droppedAfterHole: null,
    courseHandicap: 10,
    ...over,
  };
}

function teamWith(players: PlayerRow[]): TeamRow {
  return {
    id: 1, name: "Team 1", rosterDisplay: players.map(p => p.displayName).join(" · "),
    total: -2, rawTeamScore: 70, teamPar: 72, thru: 18,
    f9Total: -1, b9Total: -1, players, blindDraws: [],
  };
}

function data(opts: { isComplete?: boolean; formatConfig?: FormatConfig; format?: Format; players: PlayerRow[] }): LoadedRoundResults {
  const format = opts.format ?? "2_ball";
  return {
    playedOn: "2026-05-21",
    isComplete: opts.isComplete ?? true,
    roundId: 77,
    format,
    formatConfig: opts.formatConfig ?? { basis: "net" },
    formatLocked: true,
    teams: rankAndFormatTeams([teamWith(opts.players)], format),
    maxThru: 18,
  };
}

beforeEach(() => {
  cleanup();
  navRef.search = "";
  navRef.push.mockReset();
});

describe("RoundResultsView Part 5 — expanded player CH + GHIN Adjusted", () => {
  it("shows the allowance-adjusted PLAYING CH (golden: raw 10 @ 90% → 9), not raw CH", () => {
    // Expand the team, then the player.
    const { container } = render(<RoundResultsView data={data({
      formatConfig: { basis: "net", handicap_allowance: 90 },
      players: [player({ rpId: 1, displayName: "Alice" })],
    })} />);

    fireEvent.click(screen.getByLabelText("Expand Team 1"));
    fireEvent.click(screen.getByLabelText("Expand Alice"));

    // CH (raw 10) · PH (10 × 0.90 = 9) shown explicitly — both numbers, not the
    // collapsed single value.
    expect(container.textContent).toContain("CH 10 · PH 9");
    // PH is accented (orange) since PH ≠ CH at 90%.
    const ph = screen.getByText("PH 9");
    expect(ph).toHaveStyle({ color: "#c2410c" });
    // GHIN Adjusted total = sum of the 18 capped scores (all 4) = 72.
    const adjGroup = screen.getByText("GHIN Adjusted").parentElement!;
    expect(within(adjGroup).getByText("72")).toBeInTheDocument();
  });

  it("at 100% allowance PH equals CH and is NOT accented", () => {
    const { container } = render(<RoundResultsView data={data({
      formatConfig: { basis: "net", handicap_allowance: 100 },
      players: [player({ rpId: 1, displayName: "Alice", courseHandicap: 10 })],
    })} />);
    fireEvent.click(screen.getByLabelText("Expand Team 1"));
    fireEvent.click(screen.getByLabelText("Expand Alice"));
    expect(container.textContent).toContain("CH 10 · PH 10");
    expect(screen.getByText("PH 10")).not.toHaveStyle({ color: "#c2410c" });
  });

  it("OMITS CH · PH + GHIN Adjusted on a dropout row", () => {
    render(<RoundResultsView data={data({
      players: [player({ rpId: 2, displayName: "Dropout Dan", droppedAfterHole: 9, holesPlayed: 9 })],
    })} />);
    fireEvent.click(screen.getByLabelText("Expand Team 1"));
    fireEvent.click(screen.getByLabelText("Expand Dropout Dan"));
    expect(screen.queryByText("GHIN Adjusted")).not.toBeInTheDocument();
    expect(screen.queryByText(/PH \d+/)).not.toBeInTheDocument();
  });
});

describe("RoundResultsView Part 6 — admin Edit button", () => {
  it("is present for an admin on a finalized round", () => {
    navRef.search = "admin=1";
    render(<RoundResultsView data={data({ isComplete: true, players: [player({ rpId: 1, displayName: "Alice" })] })} />);
    expect(screen.getByTestId("summary-edit-round-button")).toBeInTheDocument();
  });

  it("is absent for a player (no admin flag)", () => {
    navRef.search = "";
    render(<RoundResultsView data={data({ isComplete: true, players: [player({ rpId: 1, displayName: "Alice" })] })} />);
    expect(screen.queryByTestId("summary-edit-round-button")).not.toBeInTheDocument();
  });

  it("is absent on a live (in-progress) round even for an admin", () => {
    navRef.search = "admin=1";
    render(<RoundResultsView data={data({ isComplete: false, players: [player({ rpId: 1, displayName: "Alice" })] })} />);
    expect(screen.queryByTestId("summary-edit-round-button")).not.toBeInTheDocument();
  });
});
