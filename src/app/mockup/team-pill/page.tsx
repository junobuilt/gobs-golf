"use client";

import { useState } from "react";
import TeamPillSegments from "@/components/scorecard/TeamPillSegments";
import type { Format } from "@/lib/scoring/types";

// A1.6 Step 1 — Static mockup for the three-segment team-net pill. Not linked
// from app navigation; access via direct URL only (/mockup/team-pill). Live
// scorecard pill is unchanged on master — Dad's active testing is unaffected.
//
// Six combos to flip through:
//   1. Best-N, mid-front-9        (F9 in progress, B9 —, Total in progress)
//   2. Best-N, mid-back-9         (F9 locked,      B9 in progress, Total in progress)
//   3. Best-N, complete           (all three filled)
//   4. Stableford, mid-front-9
//   5. Stableford, mid-back-9
//   6. Stableford, complete
//
// Numbers are fake but reconcile: F9 + B9 = Total in every state.

type Combo = {
  key: string;
  label: string;
  format: Format;
  f9: number | null;
  b9: number | null;
  total: number | null;
};

const COMBOS: Combo[] = [
  // Best-N (deltas vs par)
  { key: "bestn-mid-f9", label: "Best-N · mid front-9", format: "2_ball", f9: -2, b9: null, total: -2 },
  { key: "bestn-mid-b9", label: "Best-N · mid back-9", format: "2_ball", f9: -3, b9: 1, total: -2 },
  { key: "bestn-complete", label: "Best-N · complete", format: "2_ball", f9: -3, b9: -1, total: -4 },

  // Stableford (absolute points; F9 + B9 = Total)
  { key: "stb-mid-f9", label: "Stableford · mid front-9", format: "gobs_stableford", f9: 8, b9: null, total: 8 },
  { key: "stb-mid-b9", label: "Stableford · mid back-9", format: "gobs_stableford", f9: 18, b9: 7, total: 25 },
  { key: "stb-complete", label: "Stableford · complete", format: "gobs_stableford", f9: 18, b9: 14, total: 32 },
];

// Extra edge-case rows: empty, even (E vs 0 pts), and negative Stableford
// (GOBS Stableford defaults allow deductions). Useful for spotting layout
// regressions Jonathan might not catch in the 6 main states.
const EDGE_CASES: Combo[] = [
  { key: "empty", label: "Empty (no holes scored)", format: "2_ball", f9: null, b9: null, total: null },
  { key: "bestn-even", label: "Best-N · even total", format: "2_ball", f9: 1, b9: -1, total: 0 },
  { key: "stb-negative", label: "GOBS Stableford · negative", format: "gobs_stableford", f9: -3, b9: -2, total: -5 },
];

export default function TeamPillMockupPage() {
  const [selected, setSelected] = useState<Combo>(COMBOS[0]);

  const pageWrap: React.CSSProperties = {
    minHeight: "100vh",
    background: "#f2f1ed",
    fontFamily: "sans-serif",
    padding: "20px 15px 40px",
  };
  const frame: React.CSSProperties = {
    maxWidth: "500px",
    margin: "0 auto",
  };
  const sectionTitle: React.CSSProperties = {
    fontSize: "0.7rem",
    fontWeight: 800,
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    margin: "20px 0 8px",
  };
  const button = (active: boolean): React.CSSProperties => ({
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    marginBottom: "6px",
    background: active ? "#0b2d50" : "white",
    color: active ? "white" : "#1a1a1a",
    border: "0.5px solid #e4e4e4",
    borderRadius: "8px",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  });
  const dataRow: React.CSSProperties = {
    fontSize: "0.7rem",
    color: "#6b7280",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    padding: "10px 12px",
    background: "white",
    border: "0.5px solid #e4e4e4",
    borderRadius: "8px",
    marginTop: "12px",
  };

  return (
    <div style={pageWrap}>
      <div style={frame}>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 800, margin: "0 0 4px", color: "#0b2d50" }}>
          Team pill — A1.6 mockup
        </h1>
        <p style={{ margin: 0, fontSize: "0.75rem", color: "#6b7280", lineHeight: 1.4 }}>
          Static preview. No backend. Numbers are fake but F9 + B9 = Total in every state.
          Test at 375px viewport (iPhone SE).
        </p>

        <div style={sectionTitle}>Selected state</div>
        <TeamPillSegments
          format={selected.format}
          f9={selected.f9}
          b9={selected.b9}
          total={selected.total}
        />
        <div style={dataRow}>
          format: {selected.format}
          {"  ·  "}f9: {selected.f9 ?? "null"}
          {"  ·  "}b9: {selected.b9 ?? "null"}
          {"  ·  "}total: {selected.total ?? "null"}
        </div>

        <div style={sectionTitle}>Six required combos</div>
        {COMBOS.map(c => (
          <button key={c.key} style={button(selected.key === c.key)} onClick={() => setSelected(c)}>
            {c.label}
          </button>
        ))}

        <div style={sectionTitle}>Edge cases</div>
        {EDGE_CASES.map(c => (
          <button key={c.key} style={button(selected.key === c.key)} onClick={() => setSelected(c)}>
            {c.label}
          </button>
        ))}

        <div style={sectionTitle}>Layout check — empty vs filled, side by side</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <TeamPillSegments format="2_ball" f9={null} b9={null} total={null} />
          <TeamPillSegments format="2_ball" f9={-3} b9={-1} total={-4} />
          <TeamPillSegments format="gobs_stableford" f9={null} b9={null} total={null} />
          <TeamPillSegments format="gobs_stableford" f9={18} b9={14} total={32} />
        </div>
        <p style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: "8px", lineHeight: 1.4 }}>
          Pill height should be identical across all four rows above. Any vertical jump = a regression
          to flag.
        </p>
      </div>
    </div>
  );
}
