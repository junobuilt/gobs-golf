"use client";

import React from "react";
import PlayerHoleGrid from "@/components/scorecard/PlayerHoleGrid";
import { getTeamColor } from "@/lib/teamColors";
import { strokeDots } from "@/lib/tournament/matchScorecard";
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
  flaggedHole,
}: {
  loaded: LoadedMatch;
  scores: OptimisticScores;
  state: MatchState;
  flaggedHole: number | null;
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
      <OutcomeStrip outcomes={state.holeOutcomes} loaded={loaded} flaggedHole={flaggedHole} />
      {sideBlock("a")}
      {sideBlock("b")}
    </div>
  );
}

// The 18-hole result strip: each hole tinted by who won it on net (blue A / red B
// / grey halved / blank unresolved), read straight from MatchState.holeOutcomes.
// A flagged hole shows a ⚑ above its cell.
function OutcomeStrip({
  outcomes,
  loaded,
  flaggedHole,
}: {
  outcomes: MatchState["holeOutcomes"];
  loaded: LoadedMatch;
  flaggedHole: number | null;
}) {
  const cell = (i: number) => {
    const holeNo = i + 1;
    const o = outcomes[i];
    const bg =
      o === "side_a" ? SIDE_COLOR.a.bg : o === "side_b" ? SIDE_COLOR.b.bg : o === "halved" ? "#eef0f2" : "transparent";
    const border =
      o === "side_a" ? SIDE_COLOR.a.border : o === "side_b" ? SIDE_COLOR.b.border : o === "halved" ? "#cbd5e1" : "#e5e7eb";
    const mark = o === "side_a" ? "A" : o === "side_b" ? "B" : o === "halved" ? "½" : "";
    return (
      <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1px" }}>
        <div style={{ height: "10px", fontSize: "9px", color: "#b45309", lineHeight: 1 }}>
          {flaggedHole === holeNo ? "⚑" : ""}
        </div>
        <div style={{ fontSize: "9px", color: "#64748b" }}>{holeNo}</div>
        <div
          data-testid={`review-outcome-${holeNo}`}
          style={{
            width: "100%",
            minHeight: "18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "10px",
            fontWeight: 800,
            color: "#334155",
            background: bg,
            border: `1px solid ${border}`,
            borderRadius: "4px",
          }}
        >
          {mark}
        </div>
      </div>
    );
  };
  const nine = (start: number) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: "2px" }}>
      {Array.from({ length: 9 }, (_, k) => cell(start + k))}
    </div>
  );
  return (
    <div>
      <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "#64748b", marginBottom: "4px" }}>
        Hole results
      </div>
      {/* D11 — legend keying the compact A/B cell marks to the real side names
          (tournaments.side_a_name / side_b_name) so the strip is readable
          without prior knowledge of which letter is which side. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginBottom: "6px", fontSize: "0.68rem", fontWeight: 700, color: "#475569" }}>
        <LegendKey bg={SIDE_COLOR.a.bg} border={SIDE_COLOR.a.border} label={`A = ${loaded.sideA.displayName}`} />
        <LegendKey bg={SIDE_COLOR.b.bg} border={SIDE_COLOR.b.border} label={`B = ${loaded.sideB.displayName}`} />
        <LegendKey bg="#eef0f2" border="#cbd5e1" label="½ = Halved" />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {nine(0)}
        {nine(9)}
      </div>
    </div>
  );
}

function LegendKey({ bg, border, label }: { bg: string; border: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
      <span style={{ width: "12px", height: "12px", borderRadius: "3px", background: bg, border: `1px solid ${border}` }} />
      {label}
    </span>
  );
}
