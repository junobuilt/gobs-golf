"use client";

import React from "react";

// Wave 1B — per-hole team-card score entry. Mirrors the individual scorecard's
// +/- stepper (round/[id]/scorecard/page.tsx) but scores at the TEAM level:
//   - count-1: one stepper (one counting ball).
//   - count-2: two steppers (Ball 1 / Ball 2) + the summed hole total.
//
// A6 "dash-until-tap, par-anchored": a ball shows "—" until the first +/- tap,
// which lands on PAR, then increments/decrements (1..20). The parent owns
// persistence; this component computes the next value and calls onSet so the
// par-anchor + range guard live in one testable place.

export interface TeamHoleEntryProps {
  ballCount: number; // 1 or 2
  // length === ballCount; balls[i] = ball (i+1)'s strokes, or undefined if unentered.
  balls: (number | undefined)[];
  par: number;
  disabled?: boolean;
  // ballIndex is 1-based; value is the new strokes (already par-anchored + range-checked).
  onSet: (ballIndex: number, value: number) => void;
}

const STEP_BTN: React.CSSProperties = {
  width: "44px",
  height: "44px",
  borderRadius: "10px",
  border: "1px solid #e2e8f0",
  fontSize: "20px",
};

export default function TeamHoleEntry({
  ballCount,
  balls,
  par,
  disabled = false,
  onSet,
}: TeamHoleEntryProps) {
  const step = (ballIndex: number, delta: number) => {
    if (disabled) return;
    const current = balls[ballIndex - 1];
    const next = current == null ? par : current + delta;
    if (next < 1 || next > 20) return; // matches scorecard setScore guard
    onSet(ballIndex, next);
  };

  const entered = balls.filter((b): b is number => b != null);
  const holeTotal = entered.length > 0 ? entered.reduce((s, b) => s + b, 0) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {Array.from({ length: ballCount }, (_, i) => i + 1).map((ballIndex) => {
        const value = balls[ballIndex - 1];
        return (
          <div
            key={ballIndex}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px" }}
          >
            {ballCount > 1 && (
              <span
                style={{
                  fontSize: "0.7rem", fontWeight: 800, color: "#64748b",
                  textTransform: "uppercase", letterSpacing: "0.04em",
                  minWidth: "48px", textAlign: "right",
                }}
              >
                Ball {ballIndex}
              </span>
            )}
            <button
              type="button"
              aria-label={`Ball ${ballIndex} minus`}
              data-testid={`ball-${ballIndex}-minus`}
              onClick={() => step(ballIndex, -1)}
              disabled={disabled}
              style={{
                ...STEP_BTN,
                background: disabled ? "#f1f5f9" : "#f8fafc",
                color: disabled ? "#cbd5e1" : undefined,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              −
            </button>
            <div
              data-testid={`ball-${ballIndex}-value`}
              style={{
                fontSize: "1.8rem", fontWeight: 900, textAlign: "center",
                minWidth: "35px",
                color: value == null ? "#cbd5e1" : undefined,
              }}
            >
              {value ?? "—"}
            </div>
            <button
              type="button"
              aria-label={`Ball ${ballIndex} plus`}
              data-testid={`ball-${ballIndex}-plus`}
              onClick={() => step(ballIndex, 1)}
              disabled={disabled}
              style={{
                ...STEP_BTN,
                background: disabled ? "#f1f5f9" : "#f8fafc",
                color: disabled ? "#cbd5e1" : undefined,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              +
            </button>
          </div>
        );
      })}

      {ballCount > 1 && (
        <div
          data-testid="hole-total"
          style={{
            textAlign: "center", fontSize: "0.85rem", fontWeight: 700,
            color: "#0c3057",
          }}
        >
          Hole total: {holeTotal ?? "—"}
        </div>
      )}
    </div>
  );
}
