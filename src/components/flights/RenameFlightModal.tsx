"use client";

import { useState } from "react";

// Session 2 (Flights) — cosmetic rename of a flight. Non-blank validation only;
// trims on save. Mirrors the app's centered-modal pattern.
const NAVY = "#0b2d50";
const GOLD = "#e8a800";

export default function RenameFlightModal({
  currentName,
  onSave,
  onCancel,
}: {
  currentName: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(currentName);
  const trimmed = value.trim();

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, padding: 18,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 14, padding: 18, width: "100%",
          maxWidth: 360, boxShadow: "0 10px 30px rgba(0,0,0,.25)",
          fontFamily: "var(--font-inter), -apple-system, sans-serif",
        }}
      >
        <h3 style={{ fontSize: 15, color: NAVY, margin: "0 0 12px", fontWeight: 700 }}>
          Rename flight
        </h3>
        <input
          aria-label="Flight name"
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && trimmed) onSave(trimmed);
          }}
          style={{
            width: "100%", padding: "10px 12px", borderRadius: 8,
            border: "1px solid #cbd5e1", fontSize: 15, fontFamily: "inherit",
            color: "#1a1a1a", marginBottom: 14, boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #e4e4e4",
              background: "#fff", color: NAVY, fontWeight: 600, fontSize: 14,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!trimmed}
            onClick={() => trimmed && onSave(trimmed)}
            style={{
              flex: 1, padding: "10px", borderRadius: 8, border: "none",
              background: trimmed ? GOLD : "#cbd5e1", color: "#1a1a1a",
              fontWeight: 700, fontSize: 14,
              cursor: trimmed ? "pointer" : "not-allowed", fontFamily: "inherit",
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
