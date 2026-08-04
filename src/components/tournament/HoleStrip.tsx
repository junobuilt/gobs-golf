"use client";

// Colorized per-hole result strip (mock v4 `.hstrip` / `.holes`). One shared
// component for the Scoreboard rows and — later — the scorecard. Reads the
// canonical MatchState hole outcomes only; decides nothing.
//   A (blue)  = USA / side_a won the hole
//   C (red)   = Canada / side_b won the hole
//   ½ (split) = halved
//   · (faint) = unplayed / unresolved
//
// `holeOrder` lets a caller (e.g. a shotgun scorecard) show holes in play order;
// it defaults to natural 1..18. `outcomes` is indexed by hole number − 1.
// `flaggedHoles` (optional) draws a ⚑ above each listed hole's cell — used by the
// scorecard/review surfaces; scoreboard callers omit it (byte-identical render).

import React from "react";
import { TOURNAMENT_TOKENS as T } from "@/lib/tournament/tokens";
import type { HoleOutcome } from "@/lib/tournament/types";

function Cell({ holeNumber, outcome }: { holeNumber: number; outcome: HoleOutcome }) {
  const base: React.CSSProperties = { padding: "4px 0", borderRadius: 4, fontWeight: 700, textAlign: "center", fontSize: 10 };
  const testid = `hole-cell-${holeNumber}`;
  if (outcome === "side_a") return <div data-testid={testid} style={{ ...base, background: T.usa, color: "#fff" }}>A</div>;
  if (outcome === "side_b") return <div data-testid={testid} style={{ ...base, background: T.can, color: "#fff" }}>C</div>;
  if (outcome === "halved")
    return <div data-testid={testid} style={{ ...base, background: `linear-gradient(135deg, ${T.usa} 0 50%, ${T.can} 50% 100%)`, color: "#fff" }}>½</div>;
  return <div data-testid={testid} style={{ ...base, background: "#e7ebf1", color: "#b6bfcc", fontWeight: 600 }}>·</div>;
}

function Band({
  label,
  holeNumbers,
  outcomes,
  flaggedHoles,
}: {
  label: string;
  holeNumbers: number[];
  outcomes: HoleOutcome[];
  flaggedHoles?: number[];
}) {
  const anyFlag = (flaggedHoles?.length ?? 0) > 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `auto repeat(${holeNumbers.length}, 1fr)`, gap: 3, fontSize: 10, textAlign: "center" }}>
      {anyFlag && (
        <>
          <div />
          {holeNumbers.map((h) => (
            <div key={`fl-${h}`} style={{ height: 11, lineHeight: 1, fontSize: 9, color: "#b45309" }}>
              {flaggedHoles!.includes(h) ? "⚑" : ""}
            </div>
          ))}
        </>
      )}
      <div style={{ fontWeight: 700, color: T.muted, textAlign: "left", paddingRight: 4, fontSize: 9, display: "flex", alignItems: "center", letterSpacing: "0.04em" }}>{label}</div>
      {holeNumbers.map((h) => (
        <div key={`hn-${h}`} style={{ color: T.muted, fontWeight: 600, padding: "2px 0" }}>{h}</div>
      ))}
      <div />
      {holeNumbers.map((h) => (
        <Cell key={`cell-${h}`} holeNumber={h} outcome={outcomes[h - 1] ?? null} />
      ))}
    </div>
  );
}

export function HoleStrip({
  outcomes,
  holeOrder,
  flaggedHoles,
}: {
  outcomes: ReadonlyArray<HoleOutcome>;
  holeOrder?: number[];
  flaggedHoles?: number[];
}) {
  const order = holeOrder ?? Array.from({ length: 18 }, (_, i) => i + 1);
  const out = outcomes as HoleOutcome[];
  const front = order.slice(0, 9);
  const back = order.slice(9, 18);
  const label = (nums: number[]) => (nums.length ? `${nums[0]}–${nums[nums.length - 1]}` : "");
  return (
    <div data-testid="hole-strip">
      <Band label={label(front)} holeNumbers={front} outcomes={out} flaggedHoles={flaggedHoles} />
      {back.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <Band label={label(back)} holeNumbers={back} outcomes={out} flaggedHoles={flaggedHoles} />
        </div>
      )}
    </div>
  );
}
