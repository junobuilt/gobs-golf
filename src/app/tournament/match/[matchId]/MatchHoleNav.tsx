"use client";

import React from "react";
import { holePlayOrder } from "@/lib/tournament/matchplay";
import { TOURNAMENT_TOKENS as T } from "@/lib/tournament/tokens";
import type { HoleOutcome } from "@/lib/tournament/types";

// Ported from the league scorecard's hole navigation (round/[id]/scorecard):
// a 44px WCAG-min dot rail + a Back / Next stepper. Same touchAction hints that
// fix iOS Safari's scroll-into-tap.
//
// Shotgun (039): the rail renders in PLAY ORDER — rotated from `startHole` and
// wrapping 18→1 — and Back/Next walk that sequence (endpoints at the first and
// last played hole). startHole defaults to 1 → the ordinary 1..18 order.
//
// Mock v4 (.holenav): each circle is tinted by WHO WON the hole — the canonical
// `outcomes` (MatchState.holeOutcomes, the same data HoleStrip reads): blue USA
// (side_a) / red Canada (side_b) / split halved / faint unplayed. The current
// hole carries a gold focus ring. Nothing is recomputed here.

// The circle fill/text for a hole's outcome (unplayed = faint). Shared with the
// current-hole override below.
function outcomeStyle(outcome: HoleOutcome): { background: string; color: string; border: string } {
  if (outcome === "side_a") return { background: T.usa, color: "#fff", border: T.usa };
  if (outcome === "side_b") return { background: T.can, color: "#fff", border: T.can };
  if (outcome === "halved")
    return { background: `linear-gradient(135deg, ${T.usa} 0 50%, ${T.can} 50% 100%)`, color: "#fff", border: "transparent" };
  return { background: T.soft, color: T.muted, border: T.line }; // unplayed / unresolved
}

export function HoleDotRail({
  currentHole,
  onSelect,
  outcomes,
  startHole = 1,
}: {
  currentHole: number;
  onSelect: (hole: number) => void;
  outcomes: ReadonlyArray<HoleOutcome>;
  startHole?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        overflowX: "auto",
        gap: "6px",
        marginBottom: "12px",
        paddingBottom: "10px",
        touchAction: "pan-x",
      }}
    >
      {holePlayOrder(startHole).map((h) => {
        const isCurrent = h === currentHole;
        const oc = outcomeStyle(outcomes[h - 1] ?? null);
        return (
          <button
            key={h}
            data-testid={`hole-dot-${h}`}
            aria-current={isCurrent ? "true" : undefined}
            onClick={() => onSelect(h)}
            style={{
              minWidth: "44px",
              height: "44px",
              borderRadius: "50%",
              border: isCurrent ? `1px solid #fff` : `1px solid ${oc.border}`,
              background: isCurrent ? "#fff" : oc.background,
              color: isCurrent ? T.ink : oc.color,
              boxShadow: isCurrent ? `0 0 0 3px ${T.gold}` : undefined,
              fontSize: "0.82rem",
              fontWeight: isCurrent ? 800 : 700,
              cursor: "pointer",
              touchAction: "manipulation",
              flex: "0 0 auto",
            }}
          >
            {h}
          </button>
        );
      })}
    </div>
  );
}

export function HolePrevNext({
  currentHole,
  onSelect,
  startHole = 1,
}: {
  currentHole: number;
  onSelect: (hole: number) => void;
  startHole?: number;
}) {
  // Walk the play sequence: Back/Next move to the previous/next PLAYED hole,
  // wrapping 18→1. Endpoints are the first (startHole) and last (the hole before
  // startHole in the rotation) played holes.
  const order = holePlayOrder(startHole);
  const pos = Math.max(0, order.indexOf(currentHole));
  const atFirst = pos === 0;
  const atLast = pos === order.length - 1;
  const prevHole = order[Math.max(0, pos - 1)];
  const nextHole = order[Math.min(order.length - 1, pos + 1)];
  return (
    <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
      <button
        onClick={() => onSelect(prevHole)}
        disabled={atFirst}
        style={{
          flex: 1,
          padding: "18px",
          borderRadius: "12px",
          border: "1px solid #e2e8f0",
          background: "white",
          cursor: atFirst ? "default" : "pointer",
          opacity: atFirst ? 0.4 : 1,
          fontFamily: "sans-serif",
        }}
      >
        ← Back
      </button>
      <button
        onClick={() => onSelect(nextHole)}
        disabled={atLast}
        style={{
          flex: 2,
          padding: "18px",
          borderRadius: "12px",
          background: atLast ? "#94a3b8" : "#0c3057",
          color: "white",
          border: "none",
          fontWeight: 900,
          cursor: atLast ? "default" : "pointer",
          opacity: atLast ? 0.6 : 1,
          fontFamily: "sans-serif",
        }}
      >
        Next Hole →
      </button>
    </div>
  );
}
