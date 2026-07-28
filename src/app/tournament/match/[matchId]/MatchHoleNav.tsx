"use client";

import React from "react";

// Ported from the league scorecard's hole navigation (round/[id]/scorecard):
// a 44px WCAG-min dot rail + a Back / Next stepper. Same touchAction hints that
// fix iOS Safari's scroll-into-tap. Singles shares ONE rail + stepper across its
// two matches (Decision D) — the group walks one hole at a time.

export function HoleDotRail({
  currentHole,
  onSelect,
  hasScore,
}: {
  currentHole: number;
  onSelect: (hole: number) => void;
  hasScore: (hole: number) => boolean;
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
      {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => {
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
}: {
  currentHole: number;
  onSelect: (hole: number) => void;
}) {
  return (
    <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
      <button
        onClick={() => onSelect(Math.max(1, currentHole - 1))}
        disabled={currentHole === 1}
        style={{
          flex: 1,
          padding: "18px",
          borderRadius: "12px",
          border: "1px solid #e2e8f0",
          background: "white",
          cursor: currentHole === 1 ? "default" : "pointer",
          opacity: currentHole === 1 ? 0.4 : 1,
          fontFamily: "sans-serif",
        }}
      >
        ← Back
      </button>
      <button
        onClick={() => onSelect(Math.min(18, currentHole + 1))}
        disabled={currentHole === 18}
        style={{
          flex: 2,
          padding: "18px",
          borderRadius: "12px",
          background: currentHole === 18 ? "#94a3b8" : "#0c3057",
          color: "white",
          border: "none",
          fontWeight: 900,
          cursor: currentHole === 18 ? "default" : "pointer",
          opacity: currentHole === 18 ? 0.6 : 1,
          fontFamily: "sans-serif",
        }}
      >
        Next Hole →
      </button>
    </div>
  );
}
