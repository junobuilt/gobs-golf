"use client";

// The standardized cup PointsBar — ONE component, identical output on the Home
// hero, Tournament Home, and Scoreboard (fed everywhere by deriveCupBar, so it
// cannot drift). Ported from mock v4 `.track` / `.caps` / `.midline`.
//
// Geometry (migration 040): the bar is sized to the DECLARED tournament size
// (`barSize` = coalesce(planned, created), clamped ≥ non-voided created), so it
// doesn't resize as matches complete. Fills = side points / barSize. The point
// ticks are one per declared slot; above ~32 the minor ticks thin to texture and
// only the win + retain lines stay crisp. The win line + retain line are placed
// at their exact point values (from cupTotals via CupBar). Voided/out-of-pool
// slots render as a greyed centre band that never fills. USA (a) fills from the
// LEFT in blue, Canada (b) from the RIGHT in red.

import React from "react";
import { TOURNAMENT_TOKENS as T } from "@/lib/tournament/tokens";
import { formatCupPoints, cupOutcome, type CupBar } from "@/lib/tournament/cup";

const clampPct = (x: number): number => Math.max(0, Math.min(100, x));
const pct = (points: number, size: number): string =>
  size > 0 ? `${clampPct((points / size) * 100)}%` : "0%";

// One minor tick per declared slot. Above ~32 slots the delineations thin to a
// subtle texture (lower alpha) so a 50-slot bar stays legible.
function tickBackground(size: number): string | undefined {
  if (size < 1) return undefined;
  const alpha = size > 32 ? 0.1 : 0.2;
  const step = `calc(100% / ${size})`;
  const stepLessLine = `calc(100% / ${size} - 1px)`;
  return `repeating-linear-gradient(to right, transparent 0, transparent ${stepLessLine}, rgba(255,255,255,${alpha}) ${stepLessLine}, rgba(255,255,255,${alpha}) ${step})`;
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
  const { sideAName, sideBName, pointsA, pointsB, total, barSize, voidedCount, decided, liveNow, pointsInPlay, toWin, toRetain, holderSide } = bar;
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

  // Line + inactive-band positions are fractions of the declared barSize, so the
  // marks stay put as matches complete. Win/retain lines are measured from the
  // left; the greyed band (out-of-pool slots) sits centred, in the gap the fills
  // never reach, so it never conflicts with an edge fill.
  const retainLeft = pct(toRetain, barSize);
  const winLeft = pct(toWin, barSize);
  const inactive = Math.max(0, barSize - total); // voided + over-created-beyond-declared
  const inactiveWidthPct = clampPct((inactive / Math.max(1, barSize)) * 100);

  return (
    <div>
      {/* Track */}
      <div
        data-testid="pointsbar-track"
        data-barsize={barSize}
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
            width: pct(pointsA, barSize),
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
            width: pct(pointsB, barSize),
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
        {/* Minor point ticks (one per declared slot; thinned above ~32). */}
        <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none", background: tickBackground(barSize) }} />
        {/* Voided / out-of-pool slots: a greyed centre band that never fills. */}
        {inactive > 0 && (
          <div
            data-testid="pointsbar-inactive"
            data-voided={voidedCount}
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${clampPct(50 - inactiveWidthPct / 2)}%`,
              width: `${inactiveWidthPct}%`,
              zIndex: 2,
              pointerEvents: "none",
              background:
                "repeating-linear-gradient(45deg, rgba(120,130,145,0.55) 0, rgba(120,130,145,0.55) 5px, rgba(90,100,115,0.55) 5px, rgba(90,100,115,0.55) 10px)",
            }}
          />
        )}
        {/* Retain line (holder-safe on a tie) — thin, at its exact point value. */}
        <div data-testid="pointsbar-retainline" aria-hidden style={{ position: "absolute", top: -3, bottom: -3, left: retainLeft, width: 2, background: "rgba(255,255,255,0.55)", zIndex: 3 }} />
        {/* Win line (majority to lift the cup) — gold, crisp, at its point value. */}
        <div data-testid="pointsbar-winline" aria-hidden style={{ position: "absolute", top: -3, bottom: -3, left: winLeft, width: 3, background: T.gold, boxShadow: "0 0 0 1px rgba(0,0,0,0.25)", zIndex: 4 }} />
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
          {voidedCount > 0 ? ` · ${voidedCount} voided` : ""}
        </span>
      </div>
    </div>
  );
}
