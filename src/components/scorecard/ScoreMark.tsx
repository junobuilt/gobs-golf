import React from "react";

// Traditional golf scorecard notation. Delta = score − par.
// Negative deltas → concentric circle(s); positive deltas → concentric
// square(s). Par (delta 0) renders bare. Stroke uses currentColor so the
// notation inherits the cell's text color and renders on top of any highlight
// background.
//
// Extracted verbatim from PlayerHoleGrid (2026-07-27) so the tournament match
// card can reuse the exact notation without duplicating it. PlayerHoleGrid now
// imports this — behaviour is byte-identical.
export default function ScoreMark({ delta, score }: { delta: number; score: number }) {
  if (delta === 0) {
    return <>{score}</>;
  }

  const isCircle = delta < 0;
  const tier = Math.min(Math.abs(delta), 3); // cap at triple
  // Concentric rings nested with a CONSISTENT 3px gap on every side at each tier
  // (each ring is centered in its parent, so the gap is (outer − inner) / 2).
  // Even steps: double 26→20, triple 28→22→16.
  const sizes = tier === 1 ? [22] : tier === 2 ? [26, 20] : [28, 22, 16];

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
