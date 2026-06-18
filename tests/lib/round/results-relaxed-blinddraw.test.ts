// Spec 2 (migration 029) — a single-flight relaxed-close round (Par Competition
// / Shambles) now produces a blind-draw fill. This proves investigation #1: the
// EXISTING results.ts valuation prices these fills correctly, so the only thing
// the migration adds is the blind_draws rows — the display path is untouched.
//
// Two surfaces consume the value: /leaderboard (team.total) and
// /round/[id]/summary (RoundResultsView). BOTH read loadRoundResults' output, so
// we anchor the displayed string to the canonical drawnPlayerNetValue in one
// test — the fill the view renders is byte-for-byte the value the leaderboard's
// total is built from (cross-surface agreement, engineering rule #2/#7).
//
// Uses react-dom/server renderToString — no jsdom required.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";
import type { FakeData } from "../../components/fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

import { FakeSupabase } from "../../components/fake-supabase";
import { loadRoundResults } from "@/lib/round/results";
import RoundResultsView from "@/components/round/RoundResultsView";
import type { Format } from "@/lib/scoring/types";

// One short team (team 2, 1 player) receiving a fill from team 1's full-18
// player (rp 101 / player 201). The drawn player shoots par (gross 4 = net 4,
// CH 0) on holes 1–16 and birdie (gross 3 = net 3) on holes 17–18.
//   - Par Competition record over 1..18: 16×E + 2×(+1) = +2
//   - Shambles (best-ball NET) value: sum(net) − sum(par) = 70 − 72 = −2
function seed(format: Format): FakeData {
  const holes = [];
  for (let n = 1; n <= 18; n++) {
    holes.push({ id: n, tee_id: 1, hole_number: n, par: 4, yardage: 350, stroke_index: n });
  }
  const scores: any[] = [];
  let sid = 1;
  const push = (rpId: number, gross: (h: number) => number) => {
    for (let n = 1; n <= 18; n++) scores.push({ id: sid++, round_player_id: rpId, hole_number: n, strokes: gross(n) });
  };
  push(101, (h) => (h >= 17 ? 3 : 4)); // drawn player: +2 record / −2 net
  push(102, () => 4);
  push(103, () => 4);
  return {
    rounds: [{
      id: 1, played_on: "2026-05-13", course_id: 1, is_complete: true,
      format, format_config: { scoring_basis: "net", override_holes: [] },
      format_locked_at: "2026-05-13T00:00:00Z", created_at: "2026-05-13T00:00:00Z",
    }],
    tees: [{ id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 }],
    holes,
    round_players: [
      { id: 101, round_id: 1, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 0, dropped_after_hole: null },
      { id: 102, round_id: 1, player_id: 202, tee_id: 1, team_number: 1, course_handicap: 0, dropped_after_hole: null },
      { id: 103, round_id: 1, player_id: 203, tee_id: 1, team_number: 2, course_handicap: 0, dropped_after_hole: null },
    ],
    players: [
      { id: 201, full_name: "Drew Aaronson", display_name: "Drew", handicap_index: 0, preferred_tee_id: 1, is_active: true },
      { id: 202, full_name: "Bob Brown", display_name: "Bob", handicap_index: 0, preferred_tee_id: 1, is_active: true },
      { id: 203, full_name: "Cal Carter", display_name: "Cal", handicap_index: 0, preferred_tee_id: 1, is_active: true },
    ],
    scores,
    // The fill the new relaxed finalize writes: team 2 (short) gets drawn player 201.
    blind_draws: [
      { id: 1, round_id: 1, short_team_number: 2, drawn_player_id: 201, hole_range_start: 1, hole_range_end: 18 },
    ],
  };
}

async function loadShortTeam(format: Format) {
  fakeRef.current = new FakeSupabase(seed(format));
  const outcome = await loadRoundResults(1);
  expect(outcome.status).toBe("ok");
  if (outcome.status !== "ok") throw new Error("load failed");
  const team2 = outcome.data.teams.find((t) => t.id === 2)!;
  return { data: outcome.data, team2 };
}

describe("relaxed blind-draw fill — valuation + 🎲 display + cross-surface", () => {
  beforeEach(() => {
    fakeRef.current = null;
  });

  it("Par Competition: fill valued as the drawn player's RECORD (+2) and rendered with 🎲", async () => {
    const { data, team2 } = await loadShortTeam("par_competition");
    expect(team2.blindDraws).toHaveLength(1);
    expect(team2.blindDraws[0].drawnPlayerId).toBe(201);
    // Canonical value the leaderboard total is built from.
    expect(team2.blindDraws[0].drawnPlayerNetValue).toBe(2);

    // Summary renders the SAME value (cross-surface: displayed == canonical).
    const html = renderToString(React.createElement(RoundResultsView, { data }));
    expect(html).toContain("🎲");
    expect(html).toContain("+2 vs course");
  });

  it("Shambles: fill valued as net-vs-par (−2) and rendered with 🎲", async () => {
    const { data, team2 } = await loadShortTeam("shambles");
    expect(team2.blindDraws).toHaveLength(1);
    expect(team2.blindDraws[0].drawnPlayerId).toBe(201);
    expect(team2.blindDraws[0].drawnPlayerNetValue).toBe(-2);

    const html = renderToString(React.createElement(RoundResultsView, { data }));
    expect(html).toContain("🎲");
    expect(html).toContain("Net −2"); // U+2212 minus, per formatPlayerNet
  });
});
