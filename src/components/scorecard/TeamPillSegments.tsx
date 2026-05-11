"use client";

import { formatTeamTotal } from "@/lib/format/copy";
import type { Format } from "@/lib/scoring/types";

// A1.6: three-segment team-net pill (F9 / B9 / TOT). Replaces the single-number
// pill on the scorecard. Per-segment value semantics mirror formatTeamTotal:
//   - best-N: pass the segment's stroke delta vs par (negative = under)
//   - Stableford-family: pass the segment's absolute team points
// `null` = no holes scored in that segment yet → renders as "—".
// Dimensions are locked at the empty state via minHeight + min-width on each
// segment column so the pill does not jump as scores fill in.
export type TeamPillSegmentsProps = {
  format: Format;
  f9: number | null;
  b9: number | null;
  total: number | null;
};

export default function TeamPillSegments({ format, f9, b9, total }: TeamPillSegmentsProps) {
  const renderValue = (v: number | null): string => (v == null ? "—" : formatTeamTotal(v, format));

  const segmentStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    textAlign: "center",
    padding: "0 4px",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: "0.65rem",
    fontWeight: 800,
    opacity: 0.7,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: "4px",
    lineHeight: 1,
  };
  const valueStyle: React.CSSProperties = {
    fontSize: "1.4rem",
    fontWeight: 900,
    lineHeight: 1.1,
    minHeight: "1.55rem",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "clip",
  };
  const dividerStyle: React.CSSProperties = {
    width: "1px",
    background: "rgba(255,255,255,0.25)",
    alignSelf: "stretch",
    margin: "2px 0",
  };

  return (
    <div
      style={{
        background: "#1e40af",
        borderRadius: "12px",
        padding: "10px 12px",
        color: "white",
        display: "flex",
        alignItems: "stretch",
        gap: "0",
      }}
    >
      <div style={segmentStyle}>
        <div style={labelStyle}>F9</div>
        <div style={valueStyle}>{renderValue(f9)}</div>
      </div>
      <div style={dividerStyle} />
      <div style={segmentStyle}>
        <div style={labelStyle}>B9</div>
        <div style={valueStyle}>{renderValue(b9)}</div>
      </div>
      <div style={dividerStyle} />
      <div style={segmentStyle}>
        <div style={labelStyle}>TOT</div>
        <div style={valueStyle}>{renderValue(total)}</div>
      </div>
    </div>
  );
}
