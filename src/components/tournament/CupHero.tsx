"use client";

// The unified cup hero — one gradient banner shared by Home, Tournament Home,
// and Scoreboard (mock v4 `.hero`). Eyebrow + title + the standardized
// PointsBar + a per-surface footer slot (children): the "today" row on Home,
// the "View Full Scoreboard →" / "Tournament Home →" CTA elsewhere.

import React from "react";
import { CHROME_GRADIENT, TOURNAMENT_TOKENS as T } from "@/lib/tournament/tokens";
import type { CupBar } from "@/lib/tournament/cup";
import { PointsBar } from "./PointsBar";

export function CupHero({
  eyebrow,
  title,
  bar,
  showPointsInPlay = false,
  children,
  style,
}: {
  eyebrow: string;
  title: string;
  bar: CupBar;
  showPointsInPlay?: boolean;
  children?: React.ReactNode; // footer slot
  style?: React.CSSProperties;
}) {
  return (
    <div
      data-testid="cup-hero"
      style={{
        borderRadius: 18,
        padding: "15px 15px 14px",
        color: "#fff",
        background: CHROME_GRADIENT,
        boxShadow: "0 8px 22px rgba(6,31,61,0.28)",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: T.gold, marginBottom: 5 }}>
        {eyebrow}
      </div>
      <h2 style={{ fontWeight: 800, fontSize: 21, margin: "0 0 11px", letterSpacing: "0.02em" }}>{title}</h2>
      <PointsBar bar={bar} showPointsInPlay={showPointsInPlay} />
      {children}
    </div>
  );
}
