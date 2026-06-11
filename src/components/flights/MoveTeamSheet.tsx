"use client";

import type { Flight } from "@/lib/flights/resolve";
import { FORMAT_LABELS } from "@/lib/format/copy";
import { getHandicapAllowance, isTeamCardFormat } from "@/lib/format/helpers";

// Session 2 (Flights) — bottom sheet to move a team to another flight. One tap
// on the team's flight chip opens this; one tap on a destination moves it.
// "+ New flight" covers the create-and-move case. No drag-and-drop (the league
// demographic finds it hostile). Visual language mirrors the app's existing
// sheets (navy headings, white card, subtle option borders).
const NAVY = "#0b2d50";

function flightMeta(flight: Flight, teamCount: number): string {
  const fmt = flight.format ? FORMAT_LABELS[flight.format].title : "No format";
  const allowance = isTeamCardFormat(flight.format)
    ? null
    : `${getHandicapAllowance(flight.format_config)}%`;
  const teams = `${teamCount} ${teamCount === 1 ? "team" : "teams"}`;
  return [fmt, allowance, teams].filter(Boolean).join(" · ");
}

export default function MoveTeamSheet({
  teamNumber,
  teamRoster,
  flights,
  currentFlightId,
  teamCounts,
  onMove,
  onNewFlight,
  onCancel,
}: {
  teamNumber: number;
  teamRoster: string;
  flights: Flight[];
  currentFlightId: number;
  teamCounts: Map<number, number>;
  onMove: (flightId: number) => void;
  onNewFlight: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,.45)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        zIndex: 1000, padding: "0 14px 14px",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 16, padding: 16, width: "100%",
          maxWidth: 460, boxShadow: "0 10px 30px rgba(0,0,0,.25)",
          fontFamily: "var(--font-inter), -apple-system, sans-serif",
        }}
      >
        <h3 style={{ fontSize: 15, color: NAVY, margin: 0, fontWeight: 700 }}>
          Move Team {teamNumber} to…
        </h3>
        {teamRoster && (
          <p style={{ fontSize: 12.5, color: "#64748b", margin: "2px 0 12px" }}>{teamRoster}</p>
        )}

        {flights.map(f => {
          const selected = f.id === currentFlightId;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => (selected ? onCancel() : onMove(f.id))}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                width: "100%", textAlign: "left",
                border: `1.5px solid ${selected ? NAVY : "#e2e8f0"}`,
                background: selected ? "#eef4fb" : "#fff",
                borderRadius: 12, padding: 12, marginBottom: 8,
                fontSize: 14, fontWeight: 600, color: NAVY, cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <span>
                {f.name}
                <span style={{ display: "block", fontSize: 11.5, fontWeight: 400, color: "#64748b" }}>
                  {flightMeta(f, teamCounts.get(f.id) ?? 0)}
                </span>
              </span>
              {selected && <span style={{ color: "#15803d", fontWeight: 700 }}>✓</span>}
            </button>
          );
        })}

        <button
          type="button"
          onClick={onNewFlight}
          style={{
            display: "block", width: "100%", textAlign: "left",
            border: "1.5px solid #e2e8f0", background: "#fff",
            borderRadius: 12, padding: 12, marginBottom: 8,
            fontSize: 14, fontWeight: 600, color: NAVY, cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          + New flight
          <span style={{ display: "block", fontSize: 11.5, fontWeight: 400, color: "#64748b" }}>
            Creates a new flight and moves Team {teamNumber} into it
          </span>
        </button>

        <button
          type="button"
          onClick={onCancel}
          style={{
            display: "block", width: "100%", textAlign: "center",
            background: "transparent", border: "none",
            fontSize: 13.5, color: "#64748b", padding: "10px 0 2px", cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
