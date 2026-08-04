"use client";

import React from "react";
import PlayerHoleGrid from "@/components/scorecard/PlayerHoleGrid";
import { HoleStrip } from "@/components/tournament/HoleStrip";
import { getTeamColor } from "@/lib/teamColors";
import { strokeDots } from "@/lib/tournament/matchScorecard";
import { holePlayOrder } from "@/lib/tournament/matchplay";
import { TOURNAMENT_TOKENS as T } from "@/lib/tournament/tokens";
import type { LoadedMatch, MatchState, Side } from "@/lib/tournament/types";
import type { OptimisticScores } from "@/lib/tournament/matchScorecard";

// §C — read-only 18-hole review grid for paper verification at the turn / end.
// Reuses the league PlayerHoleGrid (gross scores + stroke dots + traditional
// notation) per unit, and adds a hole-outcomes strip read straight from the
// canonical MatchState. NO entry, NO recompute: every value is READ from the
// LoadedMatch the loader assembled + the live optimistic scores the card already
// holds. Greensomes strokes = the side's collapsed match strokes (Decision B).

// Same blue-A / red-B palette as the match card (shared team palette).
const SIDE_COLOR: Record<Side, { border: string; bg: string; text: string }> = {
  a: { border: getTeamColor(4).border, bg: getTeamColor(4).pillBg, text: getTeamColor(4).pillText },
  b: { border: getTeamColor(6).border, bg: getTeamColor(6).pillBg, text: getTeamColor(6).pillText },
};

function gross18(byHole: Record<number, number> | undefined): (number | null)[] {
  return Array.from({ length: 18 }, (_, i) => byHole?.[i + 1] ?? null);
}

export default function MatchReviewGrid({
  loaded,
  scores,
  state,
  flaggedHoles,
}: {
  loaded: LoadedMatch;
  scores: OptimisticScores;
  state: MatchState;
  flaggedHoles: number[];
}) {
  const par = loaded.holes.map((h) => h.par);
  const alloc18 = (ms: number) => loaded.holes.map((h) => strokeDots(ms, h.strokeIndex));

  // One block per side; each block lists its unit grid(s). Greensomes = one
  // collapsed side grid; four-ball / singles = one grid per player.
  const sideBlock = (side: Side) => {
    const ls = side === "a" ? loaded.sideA : loaded.sideB;
    const c = SIDE_COLOR[side];
    const units =
      loaded.session.format === "greensomes"
        ? [
            {
              key: `team-${side}`,
              label: ls.players.map((p) => p.displayName).join(" / ") || ls.displayName,
              scores: gross18(scores.teamGross[side]),
              alloc: alloc18(ls.sideMatchStrokes ?? 0),
            },
          ]
        : ls.players.map((p) => ({
            key: `p-${p.playerId}`,
            label: p.displayName,
            scores: gross18(scores.byPlayer[p.playerId]),
            alloc: alloc18(p.matchStrokes),
          }));
    return (
      <div
        key={side}
        data-testid={`review-side-${side}`}
        style={{ border: `1px solid ${c.border}`, background: c.bg, borderRadius: "8px", padding: "8px 10px" }}
      >
        <div style={{ fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", color: c.text }}>
          {ls.displayName}
        </div>
        {units.map((u) => (
          <div key={u.key} style={{ marginTop: "4px" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#111827" }}>{u.label}</div>
            <PlayerHoleGrid scores={u.scores} par={par} strokeAllocation={u.alloc} showRunningTotal />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div data-testid={`review-grid-${loaded.match.id}`} style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
      <OutcomeStrip outcomes={state.holeOutcomes} loaded={loaded} flaggedHoles={flaggedHoles} />
      {sideBlock("a")}
      {sideBlock("b")}
    </div>
  );
}

// The 18-hole result strip: each hole tinted by who won it on net, read straight
// from the canonical MatchState.holeOutcomes via the SHARED HoleStrip component —
// the SAME renderer the scoreboard uses (A = USA/side_a blue, C = Canada/side_b
// red, ½ halved, · unplayed). Holes run in PLAY ORDER (shotgun start hole first);
// a flagged hole shows a ⚑ above its cell. NO second who-won computation here.
function OutcomeStrip({
  outcomes,
  loaded,
  flaggedHoles,
}: {
  outcomes: MatchState["holeOutcomes"];
  loaded: LoadedMatch;
  flaggedHoles: number[];
}) {
  const order = holePlayOrder(loaded.match.start_hole ?? 1);
  return (
    <div>
      <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "#64748b", marginBottom: "4px" }}>
        Hole results
      </div>
      {/* D11 — legend keying the A / C cell marks to the real side names
          (tournaments.side_a_name / side_b_name) so the strip is readable
          without prior knowledge of which letter is which side. Colors match
          the strip cells (shared TOURNAMENT_TOKENS livery). */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginBottom: "6px", fontSize: "0.68rem", fontWeight: 700, color: "#475569" }}>
        <LegendKey bg={T.usa} label={`A = ${loaded.sideA.displayName}`} />
        <LegendKey bg={T.can} label={`C = ${loaded.sideB.displayName}`} />
        <LegendKey bg={`linear-gradient(135deg, ${T.usa} 0 50%, ${T.can} 50% 100%)`} label="½ = Halved" />
      </div>
      <HoleStrip outcomes={outcomes} holeOrder={order} flaggedHoles={flaggedHoles} />
    </div>
  );
}

function LegendKey({ bg, label }: { bg: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
      <span style={{ width: "12px", height: "12px", borderRadius: "3px", background: bg }} />
      {label}
    </span>
  );
}
