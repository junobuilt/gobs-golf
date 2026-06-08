"use client";

// Fund Balances panel (Phase G2 S4a). GLOBAL — not affected by the season
// toggle. Reads the fund_balances view + recent fund_transactions. No Reset
// button in 4a (reset is 4b). Read-only.

import { useEffect, useState } from "react";
import {
  loadFundBalances,
  loadRecentFundTransactions,
  type FundBalances,
  type FundTxn,
} from "@/lib/payouts/loadWinnings";

const C = {
  navyDeep: "#042C53",
  textSec: "#6b6b6b",
  textMuted: "#9a9a9a",
  border: "#e2e0db",
  red: "#b91c1c",
};

function formatDate(iso: string): string {
  // created_at is a timestamptz; show the calendar date.
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function FundsPanel() {
  const [balances, setBalances] = useState<FundBalances | null>(null);
  const [txns, setTxns] = useState<FundTxn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [b, t] = await Promise.all([
        loadFundBalances(),
        loadRecentFundTransactions(8),
      ]);
      if (cancelled) return;
      setBalances(b);
      setTxns(t);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const bfbContribs = txns.filter((t) => t.fund === "bfb" && t.amount > 0).length;

  return (
    <div style={panelStyle}>
      <div style={panelTitleStyle}>Fund Balances</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "8px" }}>
        <div style={fundCardStyle(false)}>
          <div style={fundLabelStyle}>BFB Fund</div>
          <div style={fundAmountStyle} data-testid="bfb-balance">
            ${balances?.bfb ?? 0}
          </div>
          <div style={fundSubtitleStyle}>
            {loading ? "…" : `${bfbContribs} contribution${bfbContribs === 1 ? "" : "s"}`}
          </div>
        </div>
        <div style={fundCardStyle(true)}>
          <div style={fundLabelStyle}>HiO Fund</div>
          <div style={fundAmountStyle} data-testid="hio-balance">
            ${balances?.hio ?? 0}
          </div>
          <div style={fundSubtitleStyle}>No hole-in-one payout yet</div>
        </div>
      </div>

      <div style={{ marginTop: "14px" }}>
        <div style={subsectionHeaderStyle}>Recent Transactions</div>
        {loading ? (
          <div style={{ color: C.textMuted, fontSize: "11px", padding: "6px 0" }}>…</div>
        ) : txns.length === 0 ? (
          <div style={{ color: C.textMuted, fontSize: "11px", padding: "6px 0" }}>
            No transactions yet
          </div>
        ) : (
          txns.map((t, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "4px 0",
                fontSize: "11px",
                color: t.amount < 0 ? C.red : C.textSec,
              }}
            >
              <span>
                {formatDate(t.created_at)} · {t.label}
              </span>
              <strong style={{ color: t.amount < 0 ? C.red : C.navyDeep, fontVariantNumeric: "tabular-nums" }}>
                {t.amount >= 0 ? "+" : "−"}${Math.abs(t.amount)}
              </strong>
            </div>
          ))
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
function fundCardStyle(hio: boolean): React.CSSProperties {
  return {
    background: hio
      ? "linear-gradient(135deg, #e6f0fa 0%, #d4e6f5 100%)"
      : "linear-gradient(135deg, #faf3dc 0%, #f8eed1 100%)",
    borderRadius: "10px",
    padding: "14px",
    border: `1px solid ${hio ? "#b3d4f0" : "#ecd99c"}`,
  };
}
const fundLabelStyle: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  color: C.textSec,
  marginBottom: "4px",
};
const fundAmountStyle: React.CSSProperties = {
  fontSize: "26px",
  fontWeight: 700,
  color: C.navyDeep,
  lineHeight: 1,
  marginBottom: "8px",
  fontVariantNumeric: "tabular-nums",
};
const fundSubtitleStyle: React.CSSProperties = {
  fontSize: "10px",
  color: C.textMuted,
};
const subsectionHeaderStyle: React.CSSProperties = {
  fontSize: "10px",
  textTransform: "uppercase",
  color: C.textMuted,
  letterSpacing: "0.6px",
  margin: "0 0 6px",
  fontWeight: 700,
};
