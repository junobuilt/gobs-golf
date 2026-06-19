"use client";

// Admin Money — "By Player" sub-view (F2.1 / F2.2). READ-ONLY projection of
// canonical persisted payouts via loadPlayerWinnings (no recompute). One row per
// player ranked by net descending; tap to drill into their per-round win/loss
// for the scope. Season-scoped via SeasonToggle (default this season).

import { useEffect, useState } from "react";
import SeasonToggle, { type SeasonFilter } from "@/components/season/SeasonToggle";
import type { Season } from "@/lib/seasons";
import { FORMAT_LABELS } from "@/lib/format/copy";
import {
  loadPlayerWinnings,
  type PlayerWinnings,
} from "@/lib/payouts/loadPlayerWinnings";
import { MONEY, signedMoney, moneyColor } from "./moneyTokens";

function shortDate(d: string): string {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** "+$7.47" / "−$0.60" / "$0.00" — signed average with cents. */
function signedAvg(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export default function ByPlayerPanel({
  activeSeason,
}: {
  activeSeason: Season | null;
}) {
  const [filter, setFilter] = useState<SeasonFilter>("this_season");
  const effective: SeasonFilter = activeSeason ? filter : "all_time";
  const seasonId =
    activeSeason && effective === "this_season" ? activeSeason.id : null;

  const [players, setPlayers] = useState<PlayerWinnings[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadPlayerWinnings(seasonId).then((data) => {
      if (cancelled) return;
      setPlayers(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [seasonId]);

  const scopeLabel =
    effective === "this_season" && activeSeason ? activeSeason.name : "All-time";

  return (
    <div style={panelStyle}>
      <div style={titleRowStyle}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
          <div style={panelTitleStyle}>Per Player ({scopeLabel})</div>
          <span style={sortNoteStyle}>Net ▾</span>
        </div>
        <SeasonToggle
          value={filter}
          onChange={setFilter}
          accent="navy"
          hideWhenNoActiveSeason
          activeSeason={activeSeason}
        />
      </div>

      {loading ? (
        <div style={emptyStyle}>Loading…</div>
      ) : players.length === 0 ? (
        <div style={emptyStyle}>
          No finalized rounds with payouts yet — player winnings appear here as
          rounds are finalized.
        </div>
      ) : (
        <div style={listStyle}>
          {players.map((p) => {
            const isOpen = expanded === p.playerId;
            return (
              <div key={p.playerId} style={rowWrapStyle}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : p.playerId)}
                  aria-expanded={isOpen}
                  style={rowHeaderStyle}
                  data-testid="byplayer-row"
                >
                  <span style={chevStyle(isOpen)}>▶</span>
                  <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <span style={nameStyle}>{p.name}</span>
                    <span style={subStyle}>{p.roundsPlayed} rounds</span>
                  </span>
                  <span style={{ textAlign: "right" }}>
                    <span style={{ ...amountStyle, color: moneyColor(p.net) }}>
                      {signedMoney(p.net)}
                    </span>
                    <span style={avgStyle}>avg {signedAvg(p.avg)}</span>
                  </span>
                </button>

                {isOpen && (
                  <div style={drillStyle}>
                    {p.rounds.map((r) => (
                      <div key={r.roundId} style={drillRowStyle}>
                        <span style={drillDateStyle}>{shortDate(r.playedOn)}</span>
                        <span style={drillFmtStyle}>
                          {FORMAT_LABELS[r.format]?.title ?? r.format}
                        </span>
                        <span
                          style={{ ...drillWlStyle, color: moneyColor(r.net) }}
                        >
                          {signedMoney(r.net)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: MONEY.card,
  borderRadius: "12px",
  padding: "16px",
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};
const titleRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "12px",
  paddingBottom: "8px",
  borderBottom: `1px solid ${MONEY.border}`,
  gap: "10px",
  flexWrap: "wrap",
};
const panelTitleStyle: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "1px",
  color: MONEY.textSec,
};
const sortNoteStyle: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  color: MONEY.navy,
};
const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
};
const rowWrapStyle: React.CSSProperties = {
  borderBottom: `1px solid ${MONEY.border}`,
};
const rowHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  width: "100%",
  minHeight: "52px",
  padding: "10px 4px",
  background: "none",
  border: "none",
  cursor: "pointer",
  fontFamily: "inherit",
};
function chevStyle(open: boolean): React.CSSProperties {
  return {
    color: MONEY.textMuted,
    fontSize: "11px",
    width: "12px",
    textAlign: "center",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform 0.15s",
  };
}
const nameStyle: React.CSSProperties = {
  display: "block",
  fontSize: "16px",
  fontWeight: 600,
  color: MONEY.textPri,
};
const subStyle: React.CSSProperties = {
  display: "block",
  fontSize: "13px",
  color: MONEY.textMuted,
  marginTop: "2px",
};
const amountStyle: React.CSSProperties = {
  display: "block",
  fontSize: "18px",
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
};
const avgStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  color: MONEY.textMuted,
  marginTop: "2px",
  fontVariantNumeric: "tabular-nums",
};
const drillStyle: React.CSSProperties = {
  background: MONEY.bgWarm,
  borderRadius: "8px",
  padding: "4px 12px 8px",
  margin: "0 0 8px",
};
const drillRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "8px 0",
  borderBottom: "1px solid #ecebe6",
  fontSize: "14px",
};
const drillDateStyle: React.CSSProperties = {
  width: "56px",
  fontWeight: 600,
  color: MONEY.textPri,
};
const drillFmtStyle: React.CSSProperties = {
  flex: 1,
  color: MONEY.textSec,
};
const drillWlStyle: React.CSSProperties = {
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
};
const emptyStyle: React.CSSProperties = {
  padding: "30px 20px",
  textAlign: "center",
  color: MONEY.textMuted,
  fontSize: "14px",
};
