"use client";

import React from "react";

// Shared admin toggle switch (promoted from Settings.tsx so the tournament
// Test/Live flip reuses it). Green-on / gray-off pill, 40×22, sliding knob —
// matching the league Settings toggles. Per CLAUDE.md, toggles live only in
// Settings.tsx and this shared component — never re-added to RoundSetup.
export default function Toggle({
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: boolean;
  onChange: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div
      role="switch"
      aria-checked={value}
      aria-label={ariaLabel}
      onClick={disabled ? undefined : onChange}
      style={{
        width: "40px",
        height: "22px",
        borderRadius: "11px",
        background: value ? "#2a7a3a" : "#d1d5db",
        position: "relative",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
        transition: "background 0.2s",
      }}
    >
      <div
        style={{
          width: "18px",
          height: "18px",
          borderRadius: "50%",
          background: "white",
          position: "absolute",
          top: "2px",
          left: value ? "20px" : "2px",
          transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </div>
  );
}
