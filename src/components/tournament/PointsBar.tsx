"use client";

// The standardized cup PointsBar — ONE component, identical output on the Home
// hero, Tournament Home, and Scoreboard (fed everywhere by deriveCupBar, so it
// cannot drift). Ported from mock v4 `.track` / `.caps` / `.midline`.
//
// Geometry: each fill's width = side points / total matches; the point ticks
// are dynamic (one per created match); the gold line marks the midpoint (the
// clinch line) with the exact win/retain numbers in the captions. USA (a) fills
// from the LEFT in blue, Canada (b) from the RIGHT in red.

import React from "react";
import { TOURNAMENT_TOKENS as T } from "@/lib/tournament/tokens";
import { formatCupPoints, cupOutcome, type CupBar } from "@/lib/tournament/cup";

const pct = (points: number, total: number): string =>
  total > 0 ? `${Math.max(0, Math.min(100, (points / total) * 100))}%` : "0%";

function tickBackground(total: number): string | undefined {
  if (total < 1) return undefined;
  const step = `calc(100% / ${total})`;
  const stepLessLine = `calc(100% / ${total} - 1px)`;
  return `repeating-linear-gradient(to right, transparent 0, transparent ${stepLessLine}, rgba(255,255,255,0.20) ${stepLessLine}, rgba(255,255,255,0.20) ${step})`;
}

function HolderCaption({ name, toRetain }: { name: string; toRetain: number }) {
  return (
    <>
      <span style={{ display: "block", fontWeight: 700, color: "#fff" }}>
        <span style={{ color: T.gold }}>🏆</span> {name} holds the cup
      </span>
      Retains on a {formatCupPoints(toRetain)}–{formatCupPoints(toRetain)} tie
    </>
  );
}

export function PointsBar({ bar, showPointsInPlay = false }: { bar: CupBar; showPointsInPlay?: boolean }) {
  const { sideAName, sideBName, pointsA, pointsB, total, decided, liveNow, pointsInPlay, toWin, toRetain, holderSide } = bar;
  const winCaption = `${formatCupPoints(toWin)} to win the cup`;

  // The canonical verdict (SSOT). When decided, it REPLACES the instructional
  // captions with the win/retain banner — the captions were a static holder-
  // retains label that ignored the points (the go-live cup-verdict bug).
  const verdict = cupOutcome({ pointsA, pointsB, sideAName, sideBName, holderSide, total, decided });
  const verdictColor =
    verdict.winnerSide === "a" ? T.usaDark : verdict.winnerSide === "b" ? T.canDark : "#fff";

  const capU =
    holderSide === "a" ? <HolderCaption name={sideAName} toRetain={toRetain} /> : winCaption;
  const capC =
    holderSide === "b" ? <HolderCaption name={sideBName} toRetain={toRetain} /> : holderSide === "a" ? winCaption : "";

  return (
    <div>
      {/* Track */}
      <div
        data-testid="pointsbar-track"
        style={{
          position: "relative",
          height: 36,
          borderRadius: 8,
          background: "rgba(255,255,255,0.13)",
          overflow: "hidden",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
        }}
      >
        <div
          className="pb-fill-u"
          aria-label={`${sideAName} ${formatCupPoints(pointsA)} points`}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: pct(pointsA, total),
            background: `linear-gradient(${T.usaBright}, ${T.usa})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            paddingLeft: 11,
          }}
        >
          <span data-testid="pointsbar-pts-a" style={{ fontWeight: 700, fontSize: 22, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.28)", letterSpacing: "0.01em" }}>
            {formatCupPoints(pointsA)}
          </span>
        </div>
        <div
          className="pb-fill-c"
          aria-label={`${sideBName} ${formatCupPoints(pointsB)} points`}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            right: 0,
            width: pct(pointsB, total),
            background: `linear-gradient(${T.canBright}, ${T.can})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            paddingRight: 11,
          }}
        >
          <span data-testid="pointsbar-pts-b" style={{ fontWeight: 700, fontSize: 22, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.28)", letterSpacing: "0.01em" }}>
            {formatCupPoints(pointsB)}
          </span>
        </div>
        {/* Dynamic point ticks (one per created match). */}
        <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none", background: tickBackground(total) }} />
        {/* Gold clinch line at the midpoint; exact thresholds are in the captions. */}
        <div aria-hidden style={{ position: "absolute", top: -3, bottom: -3, left: "50%", width: 3, background: T.gold, boxShadow: "0 0 0 1px rgba(0,0,0,0.25)", zIndex: 3 }} />
      </div>

      {/* Decided → the verdict banner (SSOT: cupOutcome). Otherwise the
          instructional captions (to-win on the challenger, holder + retain on
          the holder). */}
      {verdict.state !== "IN_PROGRESS" ? (
        <div
          data-testid="cup-verdict"
          style={{ textAlign: "center", marginTop: 9, fontWeight: 800, fontSize: 14, letterSpacing: "0.01em", color: verdictColor }}
        >
          <span style={{ color: T.gold }}>🏆</span> {verdict.label}
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, gap: 10 }}>
          <div data-testid="pointsbar-cap-a" style={{ fontSize: 11, lineHeight: 1.35, textAlign: "left", color: "#bcd6ff" }}>{capU}</div>
          <div data-testid="pointsbar-cap-c" style={{ fontSize: 11, lineHeight: 1.35, textAlign: "right", color: "#ffc0c9" }}>{capC}</div>
        </div>
      )}

      {/* Progress line. */}
      <div data-testid="pointsbar-midline" style={{ textAlign: "center", fontSize: 11, marginTop: 9, opacity: 0.9 }}>
        {decided} of {total} matches complete
        <span style={{ display: "block", opacity: 0.72, marginTop: 1 }}>
          {liveNow} live now{showPointsInPlay ? ` · ${pointsInPlay} point${pointsInPlay === 1 ? "" : "s"} still in play` : ""}
        </span>
      </div>
    </div>
  );
}
