"use client";

import React from "react";
import { RoundPlayer } from "@/lib/teamFormation/smartJoin";
import { Player } from "@/app/admin/page";
import { getDisplayName, type PlayerLike } from "@/lib/players/displayName";

type Props = {
  teamNumber: number;
  existingRoster: RoundPlayer[];
  playerIdsToAdd: number[];
  // Already-disambiguated short names, computed by the parent against the full
  // active roster.
  playerNamesToAdd: string[];
  // Full active roster for disambiguating the existing roster names. Defaults
  // to the existing roster itself when omitted.
  allActivePlayers?: Player[];
  onConfirm: () => void;
  onCancel: () => void;
};

const C = {
  navy: "#0b2d50",
  gold: "#e8a800",
  goldText: "#1a1a1a",
  subtext: "#64748b",
  font: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
};

function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export default function JoinTeamConfirmModal({
  teamNumber,
  existingRoster,
  playerIdsToAdd: _playerIdsToAdd,
  playerNamesToAdd,
  allActivePlayers,
  onConfirm,
  onCancel,
}: Props) {
  const nameUniverse: PlayerLike[] =
    allActivePlayers ??
    existingRoster.map((rp) => ({ id: rp.player_id, full_name: rp.players.full_name }));
  const playerName = (rp: RoundPlayer): string =>
    rp.players.full_name
      ? getDisplayName({ id: rp.player_id, full_name: rp.players.full_name }, nameUniverse)
      : (rp.players.display_name || "?");
  const joinerVerb = playerNamesToAdd.length === 1 ? "is" : "are";
  const existingNames = existingRoster.map(playerName);
  const joinerText = joinNames(playerNamesToAdd);
  const existingText = joinNames(existingNames);

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
      aria-label={`Join Team ${teamNumber}`}
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
        <h2 style={{ margin: "0 0 12px", fontSize: "1.1rem", fontWeight: 700, color: C.navy }}>
          Join Team {teamNumber}?
        </h2>
        <p style={{ margin: "0 0 20px", fontSize: "0.9rem", color: C.subtext, lineHeight: 1.5 }}>
          {joinerText} {joinerVerb} joining Team {teamNumber} (with {existingText}). Add to Team {teamNumber}?
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            onClick={onConfirm}
            style={{
              width: "100%",
              padding: "13px 16px",
              background: C.gold,
              color: C.goldText,
              border: "none",
              borderRadius: 10,
              fontSize: "0.95rem",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: C.font,
            }}
          >
            Add to Team {teamNumber}
          </button>
          <button
            onClick={onCancel}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: C.subtext,
              fontSize: "0.9rem",
              fontWeight: 500,
              padding: "6px 0",
              textAlign: "center",
              fontFamily: C.font,
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
