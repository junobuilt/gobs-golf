"use client";

// What-if payout calculator (Phase G2 S4a). Pure compute: DISPLAYS the engine
// result, never reimplements payout math. Works with zero DB data.

import { useMemo, useState } from "react";
import { calculatePayouts } from "@/lib/payoutEngine";
import { HIO_PER_PLAYER, BFB_PER_PLAYER } from "@/lib/payouts/winningsMoney";

const C = {
  navyDeep: "#042C53",
  textSec: "#6b6b6b",
  textMuted: "#9a9a9a",
  border: "#e2e0db",
  bgWarm: "#f5f4f0",
  money: "#166534",
};

const PLACE_LABELS = ["1st place team", "2nd place team", "3rd place team", "4th place team"];

export default function CalculatorPanel({ buyIn }: { buyIn: number }) {
  const [players, setPlayers] = useState(24);
  const [teamSize, setTeamSize] = useState<2 | 3 | 4>(2);

  const perPlayerPot = Math.max(0, Math.round(buyIn) - HIO_PER_PLAYER - BFB_PER_PLAYER);
  const balance = Math.max(0, Math.round(players)) * perPlayerPot;
  const numTeams = Math.floor(Math.max(0, Math.round(players)) / teamSize);

  const result = useMemo(
    () =>
      calculatePayouts({
        players: Math.max(0, Math.round(players)),
        team_size: teamSize,
        balance,
      }),
    [players, teamSize, balance],
  );

  const hasPayout = result.places_paid > 0;

  return (
    <div style={panelStyle}>
      <div style={panelTitleStyle}>What-if Calculator</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "14px" }}>
        <label style={inputGroupStyle}>
          <span style={inputLabelStyle}># of Players</span>
          <input
            type="number"
            min={4}
            max={120}
            value={players}
            onChange={(e) => setPlayers(Number(e.target.value))}
            style={inputStyle}
            aria-label="Number of players"
          />
        </label>
        <label style={inputGroupStyle}>
          <span style={inputLabelStyle}>Team Size</span>
          <select
            value={teamSize}
            onChange={(e) => setTeamSize(Number(e.target.value) as 2 | 3 | 4)}
            style={inputStyle}
            aria-label="Team size"
          >
            <option value={2}>2-player teams</option>
            <option value={3}>3-player teams</option>
            <option value={4}>4-player teams</option>
          </select>
        </label>
      </div>

      <div style={{ background: C.bgWarm, borderRadius: "8px", padding: "12px" }}>
        {hasPayout ? (
          <>
            <div style={calcHeaderStyle}>
              Projected Payouts ({numTeams} teams, ${balance} balance)
            </div>
            {result.per_player.map((amt, i) => (
              <div key={i} style={calcRowStyle}>
                <span style={{ fontWeight: 600 }}>{PLACE_LABELS[i]}</span>
                <span style={{ fontWeight: 700, color: C.money, fontVariantNumeric: "tabular-nums" }}>
                  ${amt}/player
                </span>
              </div>
            ))}
            <div style={calcSummaryStyle}>
              <span style={{ color: C.textSec }}>Total paid out</span>
              <span style={summaryValStyle}>${result.total_paid}</span>
            </div>
            <div style={{ ...calcSummaryStyle, borderTop: "none", paddingTop: "4px" }}>
              <span style={{ color: C.textSec }}>Sweep to BFB</span>
              <span style={summaryValStyle}>${result.bfb_sweep}</span>
            </div>
          </>
        ) : (
          <div style={{ textAlign: "center", color: C.textMuted, fontSize: "13px", padding: "12px 0" }}>
            Not enough players for a payout
          </div>
        )}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: "white",
  borderRadius: "12px",
  padding: "16px",
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};
const panelTitleStyle: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "1px",
  color: C.textSec,
  marginBottom: "12px",
  paddingBottom: "8px",
  borderBottom: `1px solid ${C.border}`,
};
const inputGroupStyle: React.CSSProperties = { display: "flex", flexDirection: "column" };
const inputLabelStyle: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 600,
  color: C.textSec,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  marginBottom: "4px",
};
const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: `1px solid ${C.border}`,
  borderRadius: "6px",
  fontSize: "14px",
  background: "white",
  color: C.navyDeep,
  fontWeight: 600,
  fontFamily: "inherit",
};
const calcHeaderStyle: React.CSSProperties = {
  fontSize: "11px",
  color: C.textSec,
  marginBottom: "8px",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  fontWeight: 700,
};
const calcRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "6px 0",
  borderBottom: `1px solid ${C.border}`,
  fontSize: "13px",
};
const calcSummaryStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  paddingTop: "10px",
  marginTop: "6px",
  borderTop: `2px solid ${C.border}`,
  fontSize: "11px",
};
const summaryValStyle: React.CSSProperties = {
  fontWeight: 700,
  color: C.navyDeep,
  fontVariantNumeric: "tabular-nums",
};
