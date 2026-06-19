"use client";

// Admin Money tab (F.2) — unified money/payout surface. Admin-only (the whole
// /admin/* tree is middleware-gated; NO money figure is rendered on any
// player-facing surface). Three sub-views behind one season strip:
//   Funds     — Fund Balances + reset + what-if Calculator (FundsPanel + CalculatorPanel)
//   By Player — per-player season net, ranked by net, drill to per-round W/L
//   By Round  — the existing Historical Payouts (per-round breakdown + override)
//
// All reads are projections of canonical persisted data (round_payouts +
// fund_balances via loadWinnings; loadPlayerWinnings). NOTHING here recomputes
// payouts or fund math.

import { useEffect, useState } from "react";
import { getActiveSeason, type Season } from "@/lib/seasons";
import type { LeagueSettings } from "@/app/admin/page";
import { resolveBuyIn } from "@/lib/payouts/winningsMoney";
import {
  loadFundBalances,
  loadWinningsHistory,
  type FundBalances,
} from "@/lib/payouts/loadWinnings";
import FundsPanel from "@/components/winnings/FundsPanel";
import CalculatorPanel from "@/components/winnings/CalculatorPanel";
import HistoryPanel from "@/components/winnings/HistoryPanel";
import ByPlayerPanel from "@/components/winnings/ByPlayerPanel";
import { MONEY } from "@/components/winnings/moneyTokens";

type SubView = "funds" | "by_player" | "by_round";
const SUBVIEWS: { key: SubView; label: string }[] = [
  { key: "funds", label: "Funds" },
  { key: "by_player", label: "By Player" },
  { key: "by_round", label: "By Round" },
];

export default function Money({ settings }: { settings: LeagueSettings }) {
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [seasonLoaded, setSeasonLoaded] = useState(false);
  const [sub, setSub] = useState<SubView>("funds");

  // Season strip: season-scoped buy-in/paid totals + GLOBAL fund balances.
  const [funds, setFunds] = useState<FundBalances | null>(null);
  const [seasonTotals, setSeasonTotals] = useState<{
    collected: number;
    paid: number;
    rounds: number;
  } | null>(null);

  const buyIn = resolveBuyIn(settings["buy_in_amount"]);

  useEffect(() => {
    let cancelled = false;
    getActiveSeason().then((s) => {
      if (cancelled) return;
      setActiveSeason(s);
      setSeasonLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Strip data. Buy-in/paid are summed from the canonical per-round history
  // (Σ contributed / Σ paid) — not recomputed. Fund balances are global.
  useEffect(() => {
    if (!seasonLoaded) return;
    let cancelled = false;
    const seasonId = activeSeason ? activeSeason.id : null;
    Promise.all([loadFundBalances(), loadWinningsHistory(seasonId, buyIn)]).then(
      ([b, rounds]) => {
        if (cancelled) return;
        setFunds(b);
        setSeasonTotals({
          collected: rounds.reduce((s, r) => s + r.contributed, 0),
          paid: rounds.reduce((s, r) => s + r.paid, 0),
          rounds: rounds.length,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [seasonLoaded, activeSeason, buyIn]);

  const seasonName = activeSeason?.name ?? "All-time";

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "12px" }}>
      {/* Season strip — 4 totals. Admin-only context line. */}
      <div style={stripWrapStyle}>
        <div style={stripHeaderStyle}>
          <span style={{ fontWeight: 700, color: MONEY.navyDeep }}>
            {seasonName} · season totals
          </span>
          <span style={{ color: MONEY.textMuted }}>
            {seasonTotals ? `${seasonTotals.rounds} rounds` : "…"}
          </span>
        </div>
        <div style={stripGridStyle}>
          <StripStat
            label="Buy-in collected"
            value={seasonTotals ? `$${seasonTotals.collected}` : "…"}
          />
          <StripStat
            label="Paid out to players"
            value={seasonTotals ? `$${seasonTotals.paid}` : "…"}
          />
          <StripStat
            label="HiO fund"
            value={funds ? `$${funds.hio}` : "…"}
            fund
          />
          <StripStat
            label="BFB fund"
            value={funds ? `$${funds.bfb}` : "…"}
            fund
          />
        </div>
      </div>

      {/* Sub-view switcher */}
      <div style={subnavStyle} role="tablist" aria-label="Money views">
        {SUBVIEWS.map((v) => {
          const active = sub === v.key;
          return (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSub(v.key)}
              style={subBtnStyle(active)}
            >
              {v.label}
            </button>
          );
        })}
      </div>

      {/* Sub-views */}
      {sub === "funds" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <FundsPanel />
          <CalculatorPanel buyIn={buyIn} />
        </div>
      )}
      {sub === "by_player" && seasonLoaded && (
        <ByPlayerPanel activeSeason={activeSeason} />
      )}
      {sub === "by_round" && seasonLoaded && (
        <HistoryPanel activeSeason={activeSeason} buyIn={buyIn} />
      )}
    </div>
  );
}

function StripStat({
  label,
  value,
  fund = false,
}: {
  label: string;
  value: string;
  fund?: boolean;
}) {
  return (
    <div style={statCellStyle}>
      <div style={statLabelStyle}>{label}</div>
      <div style={{ ...statValStyle, color: fund ? MONEY.navy : MONEY.navyDeep }}>
        {value}
      </div>
    </div>
  );
}

const stripWrapStyle: React.CSSProperties = {
  marginBottom: "12px",
};
const stripHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  fontSize: "13px",
  padding: "0 2px 6px",
};
const stripGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "1px",
  background: MONEY.border,
  border: `1px solid ${MONEY.border}`,
  borderRadius: "12px",
  overflow: "hidden",
};
const statCellStyle: React.CSSProperties = {
  background: MONEY.card,
  padding: "14px 16px",
};
const statLabelStyle: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  color: MONEY.textSec,
  marginBottom: "4px",
};
const statValStyle: React.CSSProperties = {
  fontSize: "22px",
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-0.01em",
};
const subnavStyle: React.CSSProperties = {
  display: "flex",
  gap: "4px",
  background: MONEY.navyDeep,
  borderRadius: "10px",
  padding: "4px",
  marginBottom: "12px",
};
function subBtnStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    minHeight: "44px",
    border: "none",
    borderRadius: "7px",
    background: active ? MONEY.card : "transparent",
    color: active ? MONEY.navyDeep : "#cbd5e1",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
