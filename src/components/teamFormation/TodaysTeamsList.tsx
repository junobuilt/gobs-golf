"use client";

import React from "react";
import { RoundPlayer } from "@/lib/teamFormation/smartJoin";
import { getTeamColor } from "@/lib/teamColors";

export type TeamEntry = {
  teamNumber: number;
  roster: RoundPlayer[];
};

type Props = {
  roundId: number;
  teams: TeamEntry[];
  onFormTeam: () => void;
  onTapTeam: (teamNumber: number) => void;
};

const C = {
  navy: "#0b2d50",
  gold: "#e8a800",
  goldText: "#1a1a1a",
  subtext: "#64748b",
  border: "#e4e4e4",
  font: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
};

function playerName(rp: RoundPlayer): string {
  return rp.players.display_name || rp.players.full_name;
}

export default function TodaysTeamsList({ roundId: _roundId, teams, onFormTeam, onTapTeam }: Props) {
  const hasTeams = teams.length > 0;

  return (
    <div style={{ fontFamily: C.font }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: C.navy }}>
          {hasTeams ? "Today's teams" : "Today's round — no teams yet"}
        </h3>
      </div>

      {hasTeams ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {teams.map((team) => {
              const tc = getTeamColor(team.teamNumber);
              const names = team.roster.map(playerName).join(", ");
              return (
                <button
                  key={team.teamNumber}
                  onClick={() => onTapTeam(team.teamNumber)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    background: tc.bg,
                    border: `1px solid ${tc.border}`,
                    borderLeft: `3px solid ${tc.border}`,
                    borderRadius: 10,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: C.font,
                    width: "100%",
                  }}
                >
                  <span
                    style={{
                      background: tc.pillBg,
                      color: tc.pillText,
                      fontSize: "0.62rem",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      padding: "2px 8px",
                      borderRadius: 999,
                      flexShrink: 0,
                    }}
                  >
                    Team {team.teamNumber}
                  </span>
                  <span style={{ fontSize: "0.85rem", color: C.subtext, flex: 1 }}>{names}</span>
                  <span style={{ fontSize: "0.75rem", color: tc.pillText, flexShrink: 0 }}>→</span>
                </button>
              );
            })}
          </div>

          <button
            onClick={onFormTeam}
            style={{
              width: "100%",
              padding: "11px 16px",
              background: "white",
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              fontSize: "0.9rem",
              fontWeight: 600,
              color: C.navy,
              cursor: "pointer",
              fontFamily: C.font,
            }}
          >
            Form a new team
          </button>
        </>
      ) : (
        <button
          onClick={onFormTeam}
          style={{
            width: "100%",
            padding: "14px 16px",
            background: C.gold,
            color: C.goldText,
            border: "none",
            borderRadius: 10,
            fontSize: "1rem",
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: C.font,
          }}
        >
          Form a team
        </button>
      )}
    </div>
  );
}
