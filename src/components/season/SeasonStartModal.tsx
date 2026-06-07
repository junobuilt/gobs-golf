"use client";

import React, { useState } from "react";

// H3.4 — auto-start prompt shown when a round is created with no active season.
// Text input for the season name (defaulted to "<year> Season") + a primary
// "Start Season and Create Round" action. Used by the homepage and admin Round
// Setup, both of which gate round creation on an active season.
interface Props {
  defaultName: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

const C = {
  navy: "#0c3057",
  gold: "#e8a800",
  goldText: "#1a1a1a",
  border: "#e4e4e4",
  subtext: "#64748b",
  font: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
};

export default function SeasonStartModal({ defaultName, onConfirm, onCancel }: Props) {
  const [name, setName] = useState(defaultName);
  const trimmed = name.trim();

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1100,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px", fontFamily: C.font,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Start a new season"
    >
      <div style={{
        background: "white", borderRadius: "16px", padding: "28px 24px",
        maxWidth: "420px", width: "100%",
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
      }}>
        <h2 style={{
          margin: "0 0 8px", fontSize: "1.15rem", fontWeight: 700, color: C.navy,
        }}>
          Starting a new season
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: "0.9rem", color: C.subtext, lineHeight: 1.5 }}>
          There&apos;s no active season. Name it, then we&apos;ll create the round.
        </p>

        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          aria-label="Season name"
          placeholder="Season name"
          onKeyDown={e => { if (e.key === "Enter" && trimmed) onConfirm(trimmed); }}
          style={{
            width: "100%", padding: "12px 14px", boxSizing: "border-box",
            border: `1.5px solid ${C.border}`, borderRadius: "10px",
            fontSize: "1rem", fontFamily: C.font, outline: "none",
            color: "#1f2937", marginBottom: "20px",
          }}
        />

        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: "13px", borderRadius: "10px",
              border: "1.5px solid #d1d5db", background: "white",
              fontSize: "0.95rem", fontWeight: 600, color: "#374151",
              cursor: "pointer", fontFamily: C.font,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => trimmed && onConfirm(trimmed)}
            disabled={!trimmed}
            style={{
              flex: 2, padding: "13px", borderRadius: "10px", border: "none",
              background: trimmed ? C.gold : "#f3f4f6",
              color: trimmed ? C.goldText : "#9ca3af",
              fontSize: "0.95rem", fontWeight: 700,
              cursor: trimmed ? "pointer" : "not-allowed",
              fontFamily: C.font,
            }}
          >
            Start Season and Create Round
          </button>
        </div>
      </div>
    </div>
  );
}
