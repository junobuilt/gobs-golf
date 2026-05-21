"use client";

import React, { useState } from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import { RoundPlayer } from "@/lib/teamFormation/smartJoin";
import { Player } from "@/app/admin/page";
import PlayerPickerSheet from "./PlayerPickerSheet";

interface Props {
  teamNumber: number;
  teamRoster: RoundPlayer[];
  unassignedActivePlayers: Player[];
  onRemove: (roundPlayerId: number) => void;
  onAdd: (playerIds: number[]) => void;
  onClose: () => void;
}

const C = {
  navy: "#0b2d50",
  gold: "#e8a800",
  cardBorder: "#e4e4e4",
  subtext: "#64748b",
  font: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
};

export default function ManageTeamSheet({
  teamNumber,
  teamRoster,
  unassignedActivePlayers,
  onRemove,
  onAdd,
  onClose,
}: Props) {
  const isMobile = useIsMobile();
  const [addPickerOpen, setAddPickerOpen] = useState(false);

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: isMobile ? "flex-end" : "center",
    justifyContent: "center",
    padding: isMobile ? 0 : 24,
    fontFamily: C.font,
  };

  const containerStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        background: "#fff",
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        boxShadow: "0 -8px 32px rgba(0,0,0,0.18)",
        padding: "12px 16px 28px",
        maxHeight: "80vh",
        display: "flex",
        flexDirection: "column",
      }
    : {
        position: "relative",
        background: "#fff",
        borderRadius: 14,
        maxWidth: 520,
        width: "100%",
        padding: "24px 24px 22px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        maxHeight: "88vh",
        display: "flex",
        flexDirection: "column",
      };

  return (
    <>
      <div
        style={overlayStyle}
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label={`Manage Team ${teamNumber}`}
      >
        <div style={containerStyle} onClick={(e) => e.stopPropagation()}>
          {isMobile && (
            <div
              style={{
                width: 44,
                height: 4,
                borderRadius: 999,
                background: "#cbd5e1",
                margin: "0 auto 14px",
                flexShrink: 0,
              }}
            />
          )}

          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
              flexShrink: 0,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: isMobile ? "1.15rem" : "1.25rem",
                fontWeight: 700,
                color: C.navy,
                letterSpacing: "-0.01em",
              }}
            >
              Manage Team {teamNumber}
            </h2>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "1.4rem",
                color: C.subtext,
                padding: "4px 8px",
                lineHeight: 1,
                fontFamily: C.font,
              }}
            >
              ×
            </button>
          </div>

          {/* Team member list */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {teamRoster.map((rp) => {
              const name = rp.players.display_name || rp.players.full_name;
              return (
                <div
                  key={rp.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "14px 0",
                    borderBottom: `0.5px solid ${C.cardBorder}`,
                  }}
                >
                  <span style={{ fontSize: "1rem", fontWeight: 500, color: "#1a1a1a" }}>
                    {name}
                  </span>
                  <button
                    onClick={() => onRemove(rp.id)}
                    aria-label={`Remove ${name}`}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "1.2rem",
                      color: C.subtext,
                      padding: "4px 8px",
                      lineHeight: 1,
                      fontFamily: C.font,
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          {/* Add player CTA */}
          <div style={{ flexShrink: 0, marginTop: 16 }}>
            <button
              onClick={() => setAddPickerOpen(true)}
              style={{
                width: "100%",
                padding: "12px 16px",
                background: "white",
                color: C.navy,
                border: `1.5px solid ${C.gold}`,
                borderRadius: 10,
                fontSize: "0.95rem",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: C.font,
              }}
            >
              + Add player
            </button>
          </div>
        </div>
      </div>

      {addPickerOpen && (
        <PlayerPickerSheet
          mode="add_to_team"
          teamNumber={teamNumber}
          activePlayers={unassignedActivePlayers}
          roundPlayers={[]}
          onAdd={(playerIds) => {
            setAddPickerOpen(false);
            onAdd(playerIds);
          }}
          onClose={() => setAddPickerOpen(false)}
        />
      )}
    </>
  );
}
