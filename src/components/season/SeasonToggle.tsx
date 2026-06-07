"use client";

// "This season / All-time" pill toggle (Phase E).
//
// Extracted 2026-06-06 (E6) from the player-profile inline toggle so the
// profile (E5) and all three admin Played-With sections (E6) share it.
//
// aria-pressed marks the active option. Click handlers stopPropagation so the
// toggle can sit inside a clickable accordion header without toggling it.

import type { Season } from "@/lib/seasons";

export type SeasonFilter = "this_season" | "all_time";

// Accent palette. The player profile has no navy token (green page), the admin
// shell is navy. Default green keeps the profile render byte-identical.
const ACCENTS: Record<"green" | "navy", string> = {
  green: "var(--green-700)",
  navy: "#0b2d50",
};

export default function SeasonToggle({
  value,
  onChange,
  accent = "green",
  hideWhenNoActiveSeason = false,
  activeSeason,
}: {
  value: SeasonFilter;
  onChange: (v: SeasonFilter) => void;
  accent?: "green" | "navy";
  // When true and no active season is present, render nothing (the surface
  // forces all-time elsewhere). Lets callers drop their own conditional.
  hideWhenNoActiveSeason?: boolean;
  activeSeason?: Season | null;
}) {
  if (hideWhenNoActiveSeason && !activeSeason) return null;

  const accentColor = ACCENTS[accent];

  const opt = (key: SeasonFilter, label: string) => {
    const selected = value === key;
    return (
      <button
        type="button"
        aria-pressed={selected}
        onClick={(e) => {
          e.stopPropagation();
          onChange(key);
        }}
        style={{
          padding: "4px 10px",
          borderRadius: "999px",
          fontSize: "0.72rem",
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "inherit",
          border: `1px solid ${accentColor}`,
          background: selected ? accentColor : "transparent",
          color: selected ? "#fff" : accentColor,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div style={{ display: "flex", gap: "4px" }}>
      {opt("this_season", "This season")}
      {opt("all_time", "All-time")}
    </div>
  );
}
