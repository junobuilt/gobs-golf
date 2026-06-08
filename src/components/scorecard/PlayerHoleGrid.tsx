"use client";

import React from "react";

// A1.7 — reusable per-player hole-by-hole grid.
// Used inline under each player row on the live scorecard (with
// currentHoleIndex set + showRunningTotal=true) and in the Phase C PR3
// drill-in summary (with currentHoleIndex omitted + showRunningTotal=false).
//
// Wave 1A — optional GHIN Adjusted Score (Net Double Bogey). When `adjScores`
// is provided (an 18-length array of NDB-capped scores, computed at 100%
// handicap by the data layer), each nine renders a second summary column
// (Adj F9 / Adj B9) in orange, and an Adj. Tot nests under Tot. When omitted,
// the grid renders exactly as before (no Adj column, no behavior change).

export interface PlayerHoleGridProps {
  // 18 entries, in hole order 1..18. null = unplayed (renders "—").
  scores: (number | null)[];
  // 18 entries, hole order 1..18. Used for notation + subtotals.
  par: number[];
  // 0..17 — highlight that hole's header + score cells. Omit to disable.
  currentHoleIndex?: number;
  // When true (default) renders the totals line bottom-right. C PR3 passes
  // false because the summary surface already shows totals. (When `adjScores`
  // is present the totals always render as the nested Tot / Adj Tot rows so
  // the Adj column has a labeled foot, regardless of this flag.)
  showRunningTotal?: boolean;
  // Wave 1A — 18-length adjusted (NDB-capped) scores. Presence enables the
  // Adj summary column + Adj. Tot.
  adjScores?: (number | null)[];
}

const COLOR_TERTIARY = "#94a3b8";
const COLOR_TEXT = "#1e293b";
const COLOR_NAVY = "#042C53";
const COLOR_HIGHLIGHT = "#dbeafe";
const COLOR_DIVIDER = "#e2e8f0";
const COLOR_ADJ = "#c2410c"; // Wave 1A orange — GHIN-adjusted accent.

const GRID_COLS = "repeat(9, minmax(0, 1fr)) minmax(0, 1.15fr)";
const GRID_COLS_ADJ = "repeat(9, minmax(0, 1fr)) minmax(0, 1.15fr) minmax(0, 1.15fr)";
const SCORE_CELL_MIN_HEIGHT = 32;

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

// Traditional golf scorecard notation. Delta = score − par.
// Negative deltas → concentric circle(s); positive deltas → concentric
// square(s). Par (delta 0) renders bare. Stroke uses currentColor so the
// notation inherits the cell's text color and renders on top of the
// current-hole highlight background.
function ScoreMark({ delta, score }: { delta: number; score: number }) {
  if (delta === 0) {
    return <>{score}</>;
  }

  const isCircle = delta < 0;
  const tier = Math.min(Math.abs(delta), 3); // cap at triple
  // Bug #1 (Wave 1A): concentric rings nested with a CONSISTENT 3px gap on
  // every side at each tier (each ring is centered in its parent, so the gap is
  // (outer − inner) / 2). The prior triple [28,22,18] gave uneven 3px/2px gaps,
  // which read as cramped. Even steps now: double 26→20, triple 28→22→16.
  const sizes =
    tier === 1 ? [22] : tier === 2 ? [26, 20] : [28, 22, 16];

  const borderRadius = isCircle ? "50%" : "0";

  let content: React.ReactNode = <span>{score}</span>;
  for (let i = sizes.length - 1; i >= 0; i--) {
    const size = sizes[i];
    content = (
      <div
        key={i}
        style={{
          width: size,
          height: size,
          borderRadius,
          border: "1px solid currentColor",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
        }}
      >
        {content}
      </div>
    );
  }
  return <>{content}</>;
}

function NineGrid({
  scores,
  par,
  currentHoleIndex,
  startIdx,
  totalLabel,
  adjScores,
}: {
  scores: (number | null)[];
  par: number[];
  currentHoleIndex?: number;
  startIdx: number;
  totalLabel: "F9" | "B9";
  adjScores?: (number | null)[];
}) {
  const indices = Array.from({ length: 9 }, (_, i) => startIdx + i);
  const parSlice = indices.map(i => par[i]);
  const scoreSlice = indices.map(i => scores[i]);
  const parSubtotal = parSlice.reduce((a, b) => a + b, 0);
  const scoreSubtotal = sumPlayed(scoreSlice);
  const showAdj = adjScores != null;
  const adjSubtotal = showAdj ? sumPlayed(indices.map(i => adjScores![i])) : null;
  const adjLabel = totalLabel === "F9" ? "Adj F9" : "Adj B9";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: showAdj ? GRID_COLS_ADJ : GRID_COLS,
        gap: "2px",
        fontSize: "11px",
        textAlign: "center",
        lineHeight: 1.2,
      }}
    >
      {/* Row 1 — hole numbers (navy primary, weight 500). Current-hole
          background highlight is the only signal of which hole is live. */}
      {indices.map(i => {
        const isCurrent = currentHoleIndex === i;
        return (
          <div
            key={`h-${i}`}
            style={{
              background: isCurrent ? COLOR_HIGHLIGHT : "transparent",
              color: COLOR_NAVY,
              fontWeight: 500,
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
          color: COLOR_NAVY,
          fontWeight: 500,
          padding: "3px 0",
          letterSpacing: "0.03em",
        }}
      >
        {totalLabel}
      </div>
      {showAdj && (
        <div
          style={{
            color: COLOR_ADJ,
            fontWeight: 700,
            padding: "3px 0",
            letterSpacing: "0.02em",
            fontSize: "10px",
            borderLeft: `1px dashed ${COLOR_ADJ}`,
          }}
        >
          {adjLabel}
        </div>
      )}

      {/* Row 2 — par (italic, muted — reference info, not data) */}
      {parSlice.map((p, j) => (
        <div
          key={`p-${j}`}
          style={{
            color: COLOR_TERTIARY,
            padding: "2px 0",
            fontWeight: 500,
            fontStyle: "italic",
          }}
        >
          {p}
        </div>
      ))}
      <div
        style={{
          color: COLOR_TERTIARY,
          fontWeight: 500,
          fontStyle: "italic",
          padding: "2px 0",
        }}
      >
        {parSubtotal}
      </div>
      {showAdj && (
        <div style={{ borderLeft: `1px dashed ${COLOR_ADJ}` }} />
      )}

      {/* Row 3 — gross score (semibold primary, with notation marks) */}
      {indices.map((i, j) => {
        const s = scoreSlice[j];
        const isCurrent = currentHoleIndex === i;
        const unplayed = s == null;
        return (
          <div
            key={`s-${i}`}
            style={{
              background: isCurrent ? COLOR_HIGHLIGHT : "transparent",
              color: unplayed ? COLOR_TERTIARY : COLOR_TEXT,
              fontWeight: 600,
              padding: "1px 0",
              borderRadius: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: SCORE_CELL_MIN_HEIGHT,
            }}
          >
            {unplayed ? "—" : <ScoreMark delta={s - par[i]} score={s} />}
          </div>
        );
      })}
      <div
        style={{
          color: scoreSubtotal == null ? COLOR_TERTIARY : COLOR_TEXT,
          fontWeight: 600,
          padding: "3px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: SCORE_CELL_MIN_HEIGHT,
        }}
      >
        {scoreSubtotal == null ? "—" : scoreSubtotal}
      </div>
      {showAdj && (
        <div
          style={{
            color: adjSubtotal == null ? COLOR_TERTIARY : COLOR_ADJ,
            fontWeight: 700,
            padding: "3px 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: SCORE_CELL_MIN_HEIGHT,
            borderLeft: `1px dashed ${COLOR_ADJ}`,
          }}
        >
          {adjSubtotal == null ? "—" : adjSubtotal}
        </div>
      )}
    </div>
  );
}

export default function PlayerHoleGrid({
  scores,
  par,
  currentHoleIndex,
  showRunningTotal = true,
  adjScores,
}: PlayerHoleGridProps) {
  const total = sumPlayed(scores);
  const showAdj = adjScores != null;
  const adjTotal = showAdj ? sumPlayed(adjScores!) : null;

  return (
    <div style={{ padding: "10px 4px 4px" }}>
      <NineGrid
        scores={scores}
        par={par}
        currentHoleIndex={currentHoleIndex}
        startIdx={0}
        totalLabel="F9"
        adjScores={adjScores}
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
        adjScores={adjScores}
      />
      {showAdj ? (
        // Wave 1A: Tot / Adj. Tot nested under the two B9 summary columns
        // (per 1A mockup). Renders whenever adjScores is present so the Adj
        // column has a labeled foot on every surface.
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID_COLS_ADJ,
            gap: "2px",
            fontSize: "11px",
            textAlign: "center",
            marginTop: "9px",
          }}
        >
          <div style={{ gridColumn: "1 / span 9" }} />
          <div style={{ fontSize: "10px", color: COLOR_TERTIARY, fontWeight: 600 }}>Tot</div>
          <div style={{ fontSize: "10px", color: COLOR_ADJ, fontWeight: 600, borderLeft: `1px dashed ${COLOR_ADJ}` }}>
            Adj Tot
          </div>
          <div style={{ gridColumn: "1 / span 9" }} />
          <div style={{
            fontSize: "16px", fontWeight: 800, color: COLOR_TEXT,
            borderTop: `1px solid ${COLOR_DIVIDER}`, paddingTop: "4px",
          }}>
            {total == null ? "—" : total}
          </div>
          <div style={{
            fontSize: "16px", fontWeight: 800, color: COLOR_ADJ,
            borderTop: `1px solid ${COLOR_DIVIDER}`, borderLeft: `1px dashed ${COLOR_ADJ}`,
            paddingTop: "4px",
          }}>
            {adjTotal == null ? "—" : adjTotal}
          </div>
        </div>
      ) : (
        showRunningTotal && (
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
        )
      )}
    </div>
  );
}
