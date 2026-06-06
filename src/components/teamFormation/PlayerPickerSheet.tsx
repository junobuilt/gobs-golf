"use client";

import React, { useState, useEffect } from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import { getTeamColor } from "@/lib/teamColors";
import { RoundPlayer, SmartJoinResult, resolveSmartJoin } from "@/lib/teamFormation/smartJoin";
import { Player } from "@/app/admin/page";
import { getDisplayName, type PlayerLike } from "@/lib/players/displayName";

type PlayerPickerProps =
  | {
      mode: "form_team";
      activePlayers: Player[];
      // Full active roster for name disambiguation. Defaults to activePlayers
      // (which is the whole roster in form_team mode).
      allActivePlayers?: Player[];
      roundPlayers: RoundPlayer[];
      onResolve: (result: SmartJoinResult) => void;
      onClose: () => void;
    }
  | {
      mode: "add_to_team";
      teamNumber: number;
      activePlayers: Player[];
      // Full active roster for name disambiguation. In add_to_team mode
      // activePlayers is only the unassigned subset, so the parent passes the
      // full roster here to keep short names consistent across surfaces.
      allActivePlayers?: Player[];
      roundPlayers: RoundPlayer[];
      onAdd: (playerIds: number[]) => void;
      onClose: () => void;
    };

const C = {
  navy: "#0b2d50",
  gold: "#e8a800",
  goldText: "#1a1a1a",
  cardBorder: "#e4e4e4",
  text: "#1a1a1a",
  subtext: "#64748b",
  chipBg: "#eef2f7",
  font: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
};

export default function PlayerPickerSheet(props: PlayerPickerProps) {
  const isMobile = useIsMobile();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Disambiguating short name ("Wayne H" / "Wayne V"), against the full active
  // roster so it matches every other surface. Falls back to the pickable list
  // when no explicit roster is supplied. Derived from full_name only.
  const nameUniverse: PlayerLike[] = props.allActivePlayers ?? props.activePlayers;
  const playerDisplayName = (p: Player): string =>
    p.full_name ? getDisplayName(p, nameUniverse) : (p.display_name || "?");

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const rpByPlayerId = new Map<number, RoundPlayer>();
  for (const rp of props.roundPlayers) {
    rpByPlayerId.set(rp.player_id, rp);
  }

  const sortedPlayers = [...props.activePlayers].sort((a, b) =>
    playerDisplayName(a).localeCompare(playerDisplayName(b)),
  );

  const visiblePlayers =
    props.mode === "add_to_team"
      ? sortedPlayers.filter((p) => {
          const rp = rpByPlayerId.get(p.id);
          return !rp || rp.team_number === 0;
        })
      : sortedPlayers;

  function togglePlayer(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function removeChip(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function handleCTA() {
    if (selectedIds.size < 1) return;
    if (props.mode === "form_team") {
      props.onResolve(resolveSmartJoin(Array.from(selectedIds), props.roundPlayers));
    } else {
      props.onAdd(Array.from(selectedIds));
    }
  }

  const ctaDisabled = selectedIds.size < 1;
  const ctaLabel =
    props.mode === "form_team" ? "Start scorecard" : `Add to Team ${props.teamNumber}`;
  const title =
    props.mode === "form_team"
      ? "Who's playing in this group?"
      : `Add players to Team ${props.teamNumber}`;
  const subtitle =
    props.mode === "form_team" ? "Tap yourself and your teammates." : undefined;

  const selectedPlayers =
    props.mode === "form_team" ? sortedPlayers.filter((p) => selectedIds.has(p.id)) : [];

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
        maxHeight: "92vh",
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
    <div
      style={overlayStyle}
      onClick={props.onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
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
        <div style={{ marginBottom: 12, flexShrink: 0 }}>
          <h2
            style={{
              margin: "0 0 4px",
              fontSize: isMobile ? "1.15rem" : "1.25rem",
              fontWeight: 700,
              color: C.navy,
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </h2>
          {subtitle && (
            <p style={{ margin: 0, fontSize: "0.85rem", color: C.subtext, lineHeight: 1.4 }}>
              {subtitle}
            </p>
          )}
        </div>

        {/* Selection chips — form_team only */}
        {props.mode === "form_team" && selectedPlayers.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: 10,
              flexShrink: 0,
            }}
          >
            {selectedPlayers.map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  background: C.chipBg,
                  borderRadius: 999,
                  padding: "4px 10px 4px 12px",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  color: C.navy,
                }}
              >
                <span>{playerDisplayName(p)}</span>
                <button
                  onClick={() => removeChip(p.id)}
                  aria-label={`Remove ${playerDisplayName(p)}`}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "0 0 0 2px",
                    fontSize: "1rem",
                    lineHeight: 1,
                    color: C.subtext,
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Player list */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            marginBottom: 12,
            borderTop: `0.5px solid ${C.cardBorder}`,
          }}
        >
          {visiblePlayers.map((p) => {
            const rp = rpByPlayerId.get(p.id);
            const teamNum = rp?.team_number ?? 0;
            const isSelected = selectedIds.has(p.id);
            const teamColor = teamNum > 0 ? getTeamColor(teamNum) : null;

            return (
              <button
                key={p.id}
                onClick={() => togglePlayer(p.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "16px 12px",
                  background: isSelected ? "#f5f8fc" : "#fff",
                  border: "none",
                  borderBottom: `0.5px solid ${C.cardBorder}`,
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: C.font,
                  minHeight: 60,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {isSelected ? (
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        background: C.navy,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ color: "#fff", fontSize: "0.7rem", fontWeight: 700 }}>
                        ✓
                      </span>
                    </span>
                  ) : (
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        border: `1.5px solid ${C.cardBorder}`,
                        flexShrink: 0,
                        display: "inline-block",
                      }}
                    />
                  )}
                  <span
                    style={{
                      fontSize: "1rem",
                      fontWeight: isSelected ? 600 : 400,
                      color: C.text,
                    }}
                  >
                    {playerDisplayName(p)}
                  </span>
                </div>
                {teamColor && (
                  <span
                    style={{
                      background: teamColor.pillBg,
                      color: teamColor.pillText,
                      borderRadius: 999,
                      padding: "3px 10px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    Team {teamNum}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            onClick={handleCTA}
            disabled={ctaDisabled}
            style={{
              width: "100%",
              padding: "14px 16px",
              background: C.gold,
              color: C.goldText,
              border: "none",
              borderRadius: 10,
              fontSize: "1rem",
              fontWeight: 700,
              cursor: ctaDisabled ? "default" : "pointer",
              opacity: ctaDisabled ? 0.5 : 1,
              fontFamily: C.font,
            }}
          >
            {ctaLabel}
          </button>
          <button
            onClick={props.onClose}
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
