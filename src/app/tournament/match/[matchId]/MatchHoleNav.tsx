"use client";

import React from "react";
import { holePlayOrder } from "@/lib/tournament/matchplay";

// Ported from the league scorecard's hole navigation (round/[id]/scorecard):
// a 44px WCAG-min dot rail + a Back / Next stepper. Same touchAction hints that
// fix iOS Safari's scroll-into-tap.
//
// Shotgun (039): the rail renders in PLAY ORDER — rotated from `startHole` and
// wrapping 18→1 — and Back/Next walk that sequence (endpoints at the first and
// last played hole). startHole defaults to 1 → the ordinary 1..18 order.

export function HoleDotRail({
  currentHole,
  onSelect,
  hasScore,
  startHole = 1,
}: {
  currentHole: number;
  onSelect: (hole: number) => void;
  hasScore: (hole: number) => boolean;
  startHole?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        overflowX: "auto",
        gap: "6px",
        marginBottom: "16px",
        paddingBottom: "10px",
        touchAction: "pan-x",
      }}
    >
      {holePlayOrder(startHole).map((h) => {
        const scored = hasScore(h);
        return (
          <button
            key={h}
            data-testid={`hole-dot-${h}`}
            onClick={() => onSelect(h)}
            style={{
              minWidth: "44px",
              height: "44px",
              borderRadius: "50%",
              border: h === currentHole ? "2px solid #0c3057" : "1px solid #e2e8f0",
              background: h === currentHole ? "#0c3057" : scored ? "#dbeafe" : "white",
              color: h === currentHole ? "white" : scored ? "#1e40af" : "#94a3b8",
              fontSize: "0.8rem",
              fontWeight: "bold",
              cursor: "pointer",
              touchAction: "manipulation",
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
