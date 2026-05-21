"use client";

import React from "react";
import { RoundPlayer } from "@/lib/teamFormation/smartJoin";

type Props = {
  teamA: number;
  teamB: number;
  playersA: RoundPlayer[];
  playersB: RoundPlayer[];
  onDismiss: () => void;
};

const C = {
  navy: "#0b2d50",
  red: "#8c2424",
  subtext: "#64748b",
  font: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
};

function playerName(rp: RoundPlayer): string {
  return rp.players.display_name || rp.players.full_name;
}

function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export default function MixedTeamsErrorModal({ teamA, teamB, playersA, playersB, onDismiss }: Props) {
  const namesA = playersA.map(playerName);
  const namesB = playersB.map(playerName);
  const verbA = namesA.length === 1 ? "is" : "are";
  const verbB = namesB.length === 1 ? "is" : "are";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: C.font,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Mixed teams error"
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: "24px 22px 20px",
          maxWidth: 420,
          width: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ fontSize: "1.6rem", marginBottom: 10 }}>⚠️</div>
        <h2 style={{ margin: "0 0 12px", fontSize: "1.1rem", fontWeight: 700, color: C.navy }}>
          Can't mix teams
        </h2>
        <p style={{ margin: "0 0 20px", fontSize: "0.9rem", color: C.subtext, lineHeight: 1.5 }}>
          {joinNames(namesA)} {verbA} on Team {teamA}; {joinNames(namesB)} {verbB} on Team {teamB} — these players can't be on the same team. Adjust your selection.
        </p>
        <button
          onClick={onDismiss}
          style={{
            width: "100%",
            padding: "13px 16px",
            background: C.navy,
            color: "#fff",
            border: "none",
            borderRadius: 10,
            fontSize: "0.95rem",
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: C.font,
          }}
        >
          Adjust selection
        </button>
      </div>
    </div>
  );
}
