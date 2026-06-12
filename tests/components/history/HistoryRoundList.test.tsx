// F.1 Parts 1 + 2 — the shared read-only History list component. Renders with
// in-memory RoundListItem fixtures (no Supabase): mini-leaderboard rows, the
// ">5 teams → +N more" cap, the 🎲 chip, and the filtered single-line mode with
// a tie-aware place label + negative control.

import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";

// Render Next's <Link> as a plain anchor so we can assert hrefs.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) =>
    React.createElement("a", { href, ...rest }, children),
}));

import HistoryRoundList from "@/components/history/HistoryRoundList";
import type { RoundListItem, HistoryTeamLine } from "@/lib/round/loadRoundsList";

function line(rank: number, teamNumber: number, playerIds: number[], total: number, totalLabel: string, placeLabel: string): HistoryTeamLine {
  return {
    teamNumber,
    name: `Team ${teamNumber}`,
    rosterDisplay: `P${playerIds.join(" · P")}`,
    playerIds,
    rank,
    total,
    totalLabel,
    placeLabel,
  };
}

function round(roundId: number, playedOn: string, teams: HistoryTeamLine[], hasBlindDraws = false): RoundListItem {
  return {
    roundId, playedOn, format: "2_ball", hasBlindDraws, teams,
    // Single-flight: one section holding every team (mirrors the loader).
    sections: [{ flightId: 1, flightName: "Flight A", format: "2_ball", teams }],
  };
}

describe("HistoryRoundList — default mode", () => {
  it("renders rounds in the order given (newest-first is the loader's job)", () => {
    const rounds = [
      round(9, "2026-06-08", [line(1, 1, [1, 2], -7, "−7", "1st of 1")]),
      round(8, "2026-06-04", [line(1, 1, [3, 4], -9, "−9", "1st of 1")]),
    ];
    const html = renderToString(<HistoryRoundList rounds={rounds} />);
    expect(html.indexOf("Jun 8")).toBeLessThan(html.indexOf("Jun 4"));
  });

  it("caps at 5 team lines and shows a bold '+N more teams' line", () => {
    const teams = Array.from({ length: 8 }, (_, i) =>
      line(i + 1, i + 1, [i + 1], i - 4, `${i - 4}`, `${i + 1} of 8`),
    );
    const html = renderToString(<HistoryRoundList rounds={[round(1, "2026-06-01", teams)]} />);
    // Only 5 of the 8 team rosters render.
    const rendered = teams.filter(t => html.includes(t.rosterDisplay)).length;
    expect(rendered).toBe(5);
    expect(html).toContain("+3 more teams · tap for full result");
  });

  it("shows the 🎲 chip only when the round has blind draws", () => {
    const withDraw = renderToString(
      <HistoryRoundList rounds={[round(1, "2026-06-01", [line(1, 1, [1], -2, "−2", "1st of 1")], true)]} />,
    );
    const without = renderToString(
      <HistoryRoundList rounds={[round(2, "2026-06-01", [line(1, 1, [1], -2, "−2", "1st of 1")], false)]} />,
    );
    expect(withDraw).toContain("🎲");
    expect(without).not.toContain("🎲");
  });

  it("links each row to the round summary", () => {
    const html = renderToString(
      <HistoryRoundList rounds={[round(42, "2026-06-01", [line(1, 1, [1], -2, "−2", "1st of 1")])]} />,
    );
    expect(html).toContain('href="/round/42/summary"');
  });

  it("shows the empty state when there are no finished rounds", () => {
    expect(renderToString(<HistoryRoundList rounds={[]} />)).toContain("No finished rounds yet");
  });
});

describe("HistoryRoundList — filtered mode", () => {
  const rounds = [
    round(1, "2026-06-08", [
      line(1, 1, [10, 11], -7, "−7", "1st of 2"),
      line(2, 2, [20, 21], -2, "−2", "2nd of 2"),
    ]),
    round(2, "2026-06-04", [
      line(1, 1, [20, 22], -9, "−9", "1st of 2"), // player 20 here
      line(2, 2, [10, 11], -1, "−1", "2nd of 2"),
    ]),
  ];

  it("shows only the rounds the player was in, with their place", () => {
    // Player 20 is in BOTH rounds (team 2 then team 1).
    const html = renderToString(<HistoryRoundList rounds={rounds} filterPlayerId={20} />);
    expect(html).toContain("2nd of 2 teams"); // round 1, finished 2nd
    expect(html).toContain("1st of 2 teams"); // round 2, won
    expect(html).toContain("won the round");
  });

  it("negative control: a player NOT in a round excludes that round", () => {
    // Player 22 is only in round 2.
    const html = renderToString(<HistoryRoundList rounds={rounds} filterPlayerId={22} />);
    expect(html).toContain('href="/round/2/summary"');
    expect(html).not.toContain('href="/round/1/summary"');
  });

  it("shows the per-player empty state when the player has no finished rounds", () => {
    const html = renderToString(<HistoryRoundList rounds={rounds} filterPlayerId={999} />);
    expect(html).toContain("No finished rounds for this player yet");
  });
});
