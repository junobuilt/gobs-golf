"use client";

import React from "react";

// A1.7 — reusable per-player hole-by-hole grid.
// Used inline under each player row on the live scorecard (with
// currentHoleIndex set + showRunningTotal=true) and will be reused in
// Phase C PR3 drill-in summary (with currentHoleIndex omitted +
// showRunningTotal=false).

export interface PlayerHoleGridProps {
  // 18 entries, in hole order 1..18. null = unplayed (renders "—").
  scores: (number | null)[];
  // 18 entries, hole order 1..18. Used for birdie detection + subtotals.
  par: number[];
  // 0..17 — highlight that hole's header + score cells. Omit to disable.
  currentHoleIndex?: number;
  // When true (default) renders the "Total N" line bottom-right. C PR3
  // passes false because the summary surface already shows totals.
  showRunningTotal?: boolean;
}

const COLOR_TERTIARY = "#94a3b8";
const COLOR_BIRDIE = "#3B6D11";
const COLOR_TEXT = "#1e293b";
const COLOR_HIGHLIGHT = "#dbeafe";
const COLOR_DIVIDER = "#e2e8f0";

const GRID_COLS = "repeat(9, minmax(0, 1fr)) minmax(0, 1.15fr)";

function sumPlayed(values: (number | null)[]): number | null {
  let total = 0;
  let any = false;
  for (const v of values) {
    if (v != null) {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}

function NineGrid({
  scores,
  par,
  currentHoleIndex,
  startIdx,
  totalLabel,
}: {
  scores: (number | null)[];
  par: number[];
  currentHoleIndex?: number;
  startIdx: number;
  totalLabel: "F9" | "B9";
}) {
  const indices = Array.from({ length: 9 }, (_, i) => startIdx + i);
  const parSlice = indices.map(i => par[i]);
  const scoreSlice = indices.map(i => scores[i]);
  const parSubtotal = parSlice.reduce((a, b) => a + b, 0);
  const scoreSubtotal = sumPlayed(scoreSlice);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: GRID_COLS,
        gap: "2px",
        fontSize: "11px",
        textAlign: "center",
        lineHeight: 1.2,
      }}
    >
      {/* Row 1 — hole numbers */}
      {indices.map(i => {
        const isCurrent = currentHoleIndex === i;
        return (
          <div
            key={`h-${i}`}
            style={{
              background: isCurrent ? COLOR_HIGHLIGHT : "transparent",
              color: isCurrent ? "#1e40af" : COLOR_TERTIARY,
              fontWeight: 700,
              padding: "3px 0",
              borderRadius: "4px",
            }}
          >
            {i + 1}
          </div>
        );
      })}
      <div
        style={{
          color: COLOR_TERTIARY,
          fontWeight: 800,
          padding: "3px 0",
          letterSpacing: "0.03em",
        }}
      >
        {totalLabel}
      </div>

      {/* Row 2 — par */}
      {parSlice.map((p, j) => (
        <div
          key={`p-${j}`}
          style={{ color: COLOR_TERTIARY, padding: "2px 0", fontWeight: 500 }}
        >
          {p}
        </div>
      ))}
      <div
        style={{
          color: COLOR_TERTIARY,
          fontWeight: 600,
          padding: "2px 0",
        }}
      >
        {parSubtotal}
      </div>

      {/* Row 3 — gross score */}
      {indices.map((i, j) => {
        const s = scoreSlice[j];
        const isCurrent = currentHoleIndex === i;
        const isBirdie = s != null && s < par[i];
        const unplayed = s == null;
        return (
          <div
            key={`s-${i}`}
            style={{
              background: isCurrent ? COLOR_HIGHLIGHT : "transparent",
              color: unplayed
                ? COLOR_TERTIARY
                : isBirdie
                ? COLOR_BIRDIE
                : COLOR_TEXT,
              fontWeight: 700,
              padding: "3px 0",
              borderRadius: "4px",
            }}
          >
            {unplayed ? "—" : s}
          </div>
        );
      })}
      <div
        style={{
          color: scoreSubtotal == null ? COLOR_TERTIARY : COLOR_TEXT,
          fontWeight: 800,
          padding: "3px 0",
        }}
      >
        {scoreSubtotal == null ? "—" : scoreSubtotal}
      </div>
    </div>
  );
}

export default function PlayerHoleGrid({
  scores,
  par,
  currentHoleIndex,
  showRunningTotal = true,
}: PlayerHoleGridProps) {
  const total = sumPlayed(scores);

  return (
    <div style={{ padding: "10px 4px 4px" }}>
      <NineGrid
        scores={scores}
        par={par}
        currentHoleIndex={currentHoleIndex}
        startIdx={0}
        totalLabel="F9"
      />
      <div
        style={{
          height: 1,
          background: COLOR_DIVIDER,
          margin: "8px 0",
        }}
      />
      <NineGrid
        scores={scores}
        par={par}
        currentHoleIndex={currentHoleIndex}
        startIdx={9}
        totalLabel="B9"
      />
      {showRunningTotal && (
        <div
          style={{
            textAlign: "right",
            marginTop: "8px",
            fontSize: "11px",
            color: "#475569",
          }}
        >
          Total{" "}
          <span style={{ fontWeight: 700, color: COLOR_TEXT }}>
            {total == null ? "—" : total}
          </span>
        </div>
      )}
    </div>
  );
}
