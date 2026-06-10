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
import { rankAndFormatTeams } from "@/lib/leaderboard/rankAndFormat";
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
        strokeAllocation: Array.from({ length: 18 }, () => 0),
        droppedAfterHole: null,
        courseHandicap: null,
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
    // Run through the real shared core so totalLabel/placeLabel match prod.
    // All fixtures here are best-N (non-Stableford), so "2_ball" labels are
    // correct even for the rows whose format is overridden afterward.
    teams: rankAndFormatTeams(teams, "2_ball"),
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

describe("RoundResultsView — Shambles renders as an individual format (Wave 1B follow-up)", () => {
  // Shambles left the team-card spine: it now shows the cross-team Individual
  // Rankings + per-player rows like any other individual format. (The
  // isTeamCardFormat gate in RoundResultsView stays for future Scramble/Alt-Shot
  // but no selectable format triggers its hide-branch today — that branch is
  // dormant until a real team-card format lands.)
  function individualData(format: Format): LoadedRoundResults {
    const base = makeData(true, [makeTeam(1, 18, 1), makeTeam(2, 18, 2)]);
    return { ...base, format };
  }

  it("shows Individual Rankings for shambles (now individual best-ball net)", () => {
    expect(renderToString(<RoundResultsView data={individualData("2_ball")} />)).toContain("Individual Rankings");
    expect(renderToString(<RoundResultsView data={individualData("shambles")} />)).toContain("Individual Rankings");
  });

  it("still renders the team headline (FINAL) for shambles", () => {
    expect(renderToString(<RoundResultsView data={individualData("shambles")} />)).toContain("FINAL");
  });
});

describe("RoundResultsView — NET team-card (Texas Scramble / Alternate Shot)", () => {
  // A NET team-card row: gross 80, team handicap 12 → net 68; team par 72 →
  // net delta −4. teamGrid carries the gross hole row. Per-hole is GROSS;
  // headline + caption are NET.
  function teamCardTeam(): RankedTeam<TeamRow> {
    return {
      id: 1,
      name: "Team 1",
      rosterDisplay: "Player A · Player B",
      total: -4, // net delta vs par
      rawTeamScore: 80,
      teamPar: 72,
      thru: 18,
      f9Total: 2, // GROSS leg delta
      b9Total: 2,
      players: [],
      blindDraws: [],
      teamGrid: { scores: Array(18).fill(null).map((_, i) => (i < 10 ? 4 : 5)), par: PAR_18 },
      teamHandicap: 12,
      teamNet: 68,
      rank: 1,
    };
  }

  function teamCardData(): LoadedRoundResults {
    return {
      ...makeData(true, [teamCardTeam()]),
      format: "texas_scramble",
    };
  }

  it("shows the NET delta headline (−4), NOT the gross delta (+8)", () => {
    const html = renderToString(<RoundResultsView data={teamCardData()} />);
    // U+2212 minus sign for negative deltas.
    expect(html).toContain("−4");
    expect(html).not.toContain("+8"); // gross delta (80 − 72) must not appear as headline
  });

  it("shows the Gross · HCP · Net caption with golden values", () => {
    const html = renderToString(<RoundResultsView data={teamCardData()} />);
    expect(html).toContain("Gross");
    expect(html).toContain("80"); // gross
    expect(html).toContain("HCP");
    expect(html).toContain("12"); // team handicap
    expect(html).toContain("Net");
    expect(html).toContain("68"); // net
  });

  it("hides Individual Rankings (one team score per hole, no per-player rows)", () => {
    const html = renderToString(<RoundResultsView data={teamCardData()} />);
    expect(html).not.toContain("Individual Rankings");
  });
});
