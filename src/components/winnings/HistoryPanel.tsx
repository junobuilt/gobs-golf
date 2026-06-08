"use client";

// Historical Payouts panel (Phase G2 S4a). Season-scoped via SeasonToggle.
// One row per finalized round that has round_payouts; tap to expand per-team
// payouts. Override badge is display-only. Export CSV respects season scope.
// Read-only.

import { useEffect, useState } from "react";
import SeasonToggle, { type SeasonFilter } from "@/components/season/SeasonToggle";
import type { Season } from "@/lib/seasons";
import { FORMAT_LABELS } from "@/lib/format/copy";
import {
  loadWinningsHistory,
  winningsToCsv,
  type WinningsRound,
} from "@/lib/payouts/loadWinnings";

const C = {
  navyDeep: "#042C53",
  navy: "#0c3057",
  textSec: "#6b6b6b",
  textMuted: "#9a9a9a",
  border: "#e2e0db",
  bgWarm: "#f5f4f0",
  money: "#166534",
  gold: "#d4a017",
};

function formatDate(d: string): string {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function HistoryPanel({
  activeSeason,
  buyIn,
}: {
  activeSeason: Season | null;
  buyIn: number;
}) {
  const [filter, setFilter] = useState<SeasonFilter>("this_season");
  const effective: SeasonFilter = activeSeason ? filter : "all_time";
  const seasonId =
    activeSeason && effective === "this_season" ? activeSeason.id : null;

  const [rounds, setRounds] = useState<WinningsRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadWinningsHistory(seasonId, buyIn).then((data) => {
      if (cancelled) return;
      setRounds(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [seasonId, buyIn]);

  const scopeLabel = effective === "this_season" && activeSeason ? activeSeason.name : "All-time";

  function handleExport() {
    const csv = winningsToCsv(rounds);
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gobs-winnings-${scopeLabel.replace(/\s+/g, "-").toLowerCase()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div style={panelStyle}>
      <div style={titleWithActionStyle}>
        <div style={{ ...panelTitleStyle, margin: 0, padding: 0, border: "none" }}>
          Historical Payouts ({scopeLabel})
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <SeasonToggle
            value={filter}
            onChange={setFilter}
            accent="navy"
            hideWhenNoActiveSeason
            activeSeason={activeSeason}
          />
          <button
            type="button"
            onClick={handleExport}
            disabled={rounds.length === 0}
            style={exportBtnStyle(rounds.length === 0)}
          >
            Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div style={emptyStyle}>Loading…</div>
      ) : rounds.length === 0 ? (
        <div style={emptyStyle}>
          No finalized rounds with payouts yet — they&apos;ll appear here as rounds are finalized.
        </div>
      ) : (
        rounds.map((r) => {
          const isExpanded = expanded === r.roundId;
          const teamSizeSuffix =
            r.teamSize != null ? ` (${r.teamSize}-per)` : "";
          return (
            <div
              key={r.roundId}
              onClick={() => setExpanded(isExpanded ? null : r.roundId)}
              style={historyRowStyle(isExpanded)}
              data-testid="winnings-history-row"
            >
              <div style={rowHeaderStyle}>
                <div>
                  <span style={{ fontWeight: 700, color: C.navyDeep, fontSize: "14px" }}>
                    {formatDate(r.playedOn)}
                  </span>
                  <span style={{ marginLeft: "8px", fontSize: "10px", color: C.textSec, textTransform: "uppercase", letterSpacing: "0.4px", fontWeight: 600 }}>
                    {FORMAT_LABELS[r.format]?.title ?? r.format} · {r.headcount} plyrs · {r.numTeams} teams{teamSizeSuffix}
                  </span>
                  {r.hasOverride && <span style={overrideBadgeStyle}>Admin Override</span>}
                </div>
                <div style={{ color: C.money, fontWeight: 700, fontSize: "13px", whiteSpace: "nowrap" }}>
                  ${r.paid} paid · ${r.sweepToBfb} to BFB
                </div>
              </div>

              <div style={statsStyle}>
                <span style={statStyle}>Contributed: <strong style={statStrong}>${r.contributed}</strong></span>
                <span style={statStyle}>HiO: <strong style={statStrong}>${r.hio}</strong></span>
                <span style={statStyle}>BFB: <strong style={statStrong}>${r.bfb}</strong></span>
                <span style={statStyle}>Balance: <strong style={statStrong}>${r.balance}</strong></span>
              </div>

              {isExpanded && (
                <div style={expandedStyle}>
                  <div style={subsectionHeaderStyle}>Team Payouts</div>
                  {r.teams.map((t) => {
                    const rankLabel = (t.isTied ? "T" : "") + t.place;
                    const gold = t.place === 1;
                    return (
                      <div key={t.teamNumber} style={teamPayoutStyle}>
                        <div>
                          <div style={{ color: "#1a1a1a", fontWeight: 600 }}>
                            <span style={rankBadgeStyle(gold)}>{rankLabel}</span>
                            Team {t.teamNumber}
                            {t.isTied && <span title="Tied" style={{ marginLeft: "6px" }}>🤝</span>}
                          </div>
                          <div style={{ color: C.textMuted, fontSize: "10px", marginTop: "2px" }}>
                            {t.roster}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ color: C.money, fontWeight: 700, fontSize: "13px", fontVariantNumeric: "tabular-nums" }}>
                            ${t.totalForTeam}
                          </div>
                          <div style={{ fontSize: "10px", color: C.textMuted, fontWeight: 500 }}>
                            ${t.perPlayer}/player × {t.teamSize}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
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
};
const titleWithActionStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "12px",
  paddingBottom: "8px",
  borderBottom: `1px solid ${C.border}`,
  gap: "10px",
  flexWrap: "wrap",
};
function exportBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "5px 10px",
    fontSize: "11px",
    fontWeight: 600,
    borderRadius: "6px",
    border: `1px solid ${C.navy}`,
    background: "white",
    color: C.navy,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    fontFamily: "inherit",
  };
}
function historyRowStyle(expanded: boolean): React.CSSProperties {
  return {
    background: expanded ? "white" : C.bgWarm,
    border: expanded ? `1px solid ${C.border}` : "1px solid transparent",
    borderRadius: "8px",
    padding: "12px",
    marginBottom: "8px",
    cursor: "pointer",
  };
}
const rowHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  marginBottom: "6px",
  gap: "10px",
};
const statsStyle: React.CSSProperties = {
  display: "flex",
  gap: "12px",
  fontSize: "11px",
  color: C.textSec,
  flexWrap: "wrap",
};
const statStyle: React.CSSProperties = { display: "flex", alignItems: "baseline", gap: "3px" };
const statStrong: React.CSSProperties = {
  color: C.navyDeep,
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
};
const expandedStyle: React.CSSProperties = {
  marginTop: "12px",
  paddingTop: "12px",
  borderTop: `1px solid ${C.border}`,
  fontSize: "12px",
};
const subsectionHeaderStyle: React.CSSProperties = {
  fontSize: "10px",
  textTransform: "uppercase",
  color: C.textMuted,
  letterSpacing: "0.6px",
  margin: "0 0 6px",
  fontWeight: 700,
};
const teamPayoutStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "6px 0",
  borderBottom: "1px dashed #ecebe6",
};
function rankBadgeStyle(gold: boolean): React.CSSProperties {
  return {
    width: "18px",
    height: "18px",
    fontSize: "10px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    verticalAlign: "middle",
    marginRight: "6px",
    borderRadius: "50%",
    fontWeight: 700,
    background: gold ? C.gold : C.navy,
    color: gold ? C.navyDeep : "white",
    padding: "0 2px",
  };
}
const overrideBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  background: "#fef3c7",
  color: "#92400e",
  fontSize: "9px",
  padding: "2px 6px",
  borderRadius: "4px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.3px",
  marginLeft: "6px",
};
const emptyStyle: React.CSSProperties = {
  padding: "30px 20px",
  textAlign: "center",
  color: C.textMuted,
  fontSize: "13px",
};
