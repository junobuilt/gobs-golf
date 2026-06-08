// Non-DOM tests for the per-team thru/FINAL caption in RoundResultsView.
// Uses react-dom/server renderToString — no jsdom required.

import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {},
}));

import RoundResultsView from "@/components/round/RoundResultsView";
import type { LoadedRoundResults, TeamRow } from "@/lib/round/results";
import type { RankedTeam } from "@/lib/leaderboard/rank";
import type { Format } from "@/lib/scoring";

const PAR_18 = [4, 4, 4, 3, 5, 4, 3, 5, 4, 4, 4, 3, 5, 4, 3, 5, 4, 4];
const SCORES_18: (number | null)[] = Array(18).fill(4);

function makeTeam(
  id: number,
  thru: number,
  rank = id,
): RankedTeam<TeamRow> {
  return {
    id,
    name: `Team ${id}`,
    rosterDisplay: "Player A · Player B",
    total: -2,
    rawTeamScore: 70,
    teamPar: 72,
    thru,
    f9Total: thru >= 9 ? -1 : null,
    b9Total: thru === 18 ? -1 : null,
    players: [
      {
        rpId: id * 10,
        displayName: "Player A",
        grossTotal: 72,
        netValue: -2,
        netTotal: 70,
        holesPlayed: thru,
        scores: SCORES_18,
        par: PAR_18,
        adjScores: SCORES_18,
        droppedAfterHole: null,
      },
    ],
    blindDraws: [],
    rank,
  };
}

function makeData(
  isComplete: boolean,
  teams: RankedTeam<TeamRow>[],
): LoadedRoundResults {
  return {
    playedOn: "2026-05-21",
    isComplete,
    roundId: 999,
    format: "2_ball",
    formatConfig: { basis: "net" },
    formatLocked: isComplete,
    teams,
    maxThru: teams.reduce((m, t) => Math.max(m, t.thru), 0),
  };
}

describe("RoundResultsView — per-team score caption", () => {
  it("shows THRU N when round is in progress and team has played holes", () => {
    const data = makeData(false, [makeTeam(1, 8)]);
    const html = renderToString(<RoundResultsView data={data} />);
    // text-transform:uppercase is CSS — the source is lowercase "thru 8"
    expect(html).toContain("THRU 8");
  });

  it("shows FINAL on every team card when round is complete", () => {
    const data = makeData(true, [makeTeam(1, 18, 1), makeTeam(2, 18, 2)]);
    const html = renderToString(<RoundResultsView data={data} />);
    const matches = html.match(/FINAL/g) ?? [];
    // One "FINAL" per team card (2 teams)
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("THRU");
  });

  it("shows em-dash when round is in progress and team thru = 0", () => {
    const data = makeData(false, [makeTeam(1, 0)]);
    const html = renderToString(<RoundResultsView data={data} />);
    expect(html).toContain("—");
    expect(html).not.toContain("THRU");
    expect(html).not.toContain("FINAL");
  });

  it("caption is in a smaller font div below the score", () => {
    const data = makeData(false, [makeTeam(1, 8)]);
    const html = renderToString(<RoundResultsView data={data} />);
    // Score div (font-size:24px) appears before caption div (font-size:10px)
    const scorePos = html.indexOf("font-size:24px");
    const captionPos = html.indexOf("THRU 8");
    expect(scorePos).toBeGreaterThan(-1);
    expect(captionPos).toBeGreaterThan(scorePos);
  });

  it("does not render old 'Net pts' Stableford caption anywhere", () => {
    const inProgress = makeData(false, [makeTeam(1, 5)]);
    const complete = makeData(true, [makeTeam(1, 18)]);
    for (const data of [inProgress, complete]) {
      const html = renderToString(<RoundResultsView data={data} />);
      expect(html).not.toContain("Net pts");
    }
  });
});

describe("RoundResultsView — team-card (Shambles)", () => {
  // Players carry holesPlayed 18, so the cross-team Individual Rankings section
  // WOULD render if it weren't gated — a true negative control for the gate.
  function teamCardData(format: Format): LoadedRoundResults {
    const base = makeData(true, [makeTeam(1, 18, 1), makeTeam(2, 18, 2)]);
    return {
      ...base,
      format,
      teams: base.teams.map(t => ({ ...t, teamGrid: { scores: SCORES_18, par: PAR_18 } })),
    };
  }

  it("hides Individual Rankings for team-card (present for an individual format)", () => {
    expect(renderToString(<RoundResultsView data={teamCardData("2_ball")} />)).toContain("Individual Rankings");
    expect(renderToString(<RoundResultsView data={teamCardData("shambles")} />)).not.toContain("Individual Rankings");
  });

  it("still renders the team headline (FINAL) for team-card", () => {
    expect(renderToString(<RoundResultsView data={teamCardData("shambles")} />)).toContain("FINAL");
  });
});
