"use client";

// Fund Balances panel. GLOBAL — not affected by the season toggle. Reads the
// fund_balances view + recent fund_transactions. S4b adds the Reset Fund write
// surface: each card gets a "Reset Fund..." button → DangerModal with a
// required reason → reset_fund RPC (the only write path; client never writes
// fund_transactions directly).

import { useCallback, useEffect, useState } from "react";
import {
  loadFundBalances,
  loadRecentFundTransactions,
  type FundBalances,
  type FundTxn,
} from "@/lib/payouts/loadWinnings";
import { resetFund, type FundKind } from "@/lib/payouts/resetFund";
import DangerModal from "@/app/admin/components/DangerModal";

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

const FUND_LABEL: Record<FundKind, string> = { bfb: "BFB", hio: "HiO" };
const RESET_PLACEHOLDER: Record<FundKind, string> = {
  bfb: "e.g., Donated to Blaine Food Bank",
  hio: "e.g., Bill C ace on hole 12",
};

export default function FundsPanel() {
  const [balances, setBalances] = useState<FundBalances | null>(null);
  const [txns, setTxns] = useState<FundTxn[]>([]);
  const [loading, setLoading] = useState(true);

  // S4b reset flow state.
  const [resettingFund, setResettingFund] = useState<FundKind | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [b, t] = await Promise.all([
      loadFundBalances(),
      loadRecentFundTransactions(8),
    ]);
    setBalances(b);
    setTxns(t);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [b, t] = await Promise.all([
        loadFundBalances(),
        loadRecentFundTransactions(8),
      ]);
      if (cancelled) return;
      setBalances(b);
      setTxns(t);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function openReset(fund: FundKind) {
    setResettingFund(fund);
    setReason("");
    setResetError(null);
  }
  function closeReset() {
    setResettingFund(null);
    setReason("");
    setSubmitting(false);
    setResetError(null);
  }
  async function confirmReset() {
    if (!resettingFund) return;
    setSubmitting(true);
    setResetError(null);
    try {
      await resetFund(resettingFund, reason);
      await reload();
      closeReset();
    } catch (e) {
      setResetError(e instanceof Error ? e.message : "Reset failed. Try again.");
      setSubmitting(false);
    }
  }

  const bfbContribs = txns.filter((t) => t.fund === "bfb" && t.amount > 0).length;
  const resetBalance =
    resettingFund ? (resettingFund === "bfb" ? balances?.bfb : balances?.hio) ?? 0 : 0;

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
          <button
            type="button"
            style={resetBtnStyle(false)}
            data-testid="reset-bfb-btn"
            disabled={loading}
            onClick={() => openReset("bfb")}
          >
            Reset Fund…
          </button>
        </div>
        <div style={fundCardStyle(true)}>
          <div style={fundLabelStyle}>HiO Fund</div>
          <div style={fundAmountStyle} data-testid="hio-balance">
            ${balances?.hio ?? 0}
          </div>
          <div style={fundSubtitleStyle}>No hole-in-one payout yet</div>
          <button
            type="button"
            style={resetBtnStyle(true)}
            data-testid="reset-hio-btn"
            disabled={loading}
            onClick={() => openReset("hio")}
          >
            Reset Fund…
          </button>
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

      {resettingFund && (
        <DangerModal
          title={`Reset ${FUND_LABEL[resettingFund]} Fund?`}
          description={`This will zero out the ${FUND_LABEL[resettingFund]} Fund balance of $${resetBalance} by logging a balancing entry.`}
          confirmLabel={submitting ? "Resetting…" : "Reset Fund"}
          confirmDisabled={reason.trim() === "" || submitting}
          onConfirm={confirmReset}
          onCancel={closeReset}
        >
          <div style={{ textAlign: "left" }}>
            <label
              htmlFor="fund-reset-reason"
              style={{ fontSize: "0.8rem", fontWeight: 600, color: "#4b5563" }}
            >
              Reason (required for log):
            </label>
            <input
              id="fund-reset-reason"
              type="text"
              aria-label="Fund reset reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={RESET_PLACEHOLDER[resettingFund]}
              disabled={submitting}
              style={{
                marginTop: "6px",
                width: "100%",
                padding: "8px",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                fontSize: "0.85rem",
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
            />
            {resetError && (
              <div style={{ marginTop: "6px", fontSize: "0.78rem", color: C.red }}>
                {resetError}
              </div>
            )}
          </div>
        </DangerModal>
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
function resetBtnStyle(hio: boolean): React.CSSProperties {
  return {
    background: "white",
    border: `1px solid ${hio ? "#99c2e6" : "#d0c89a"}`,
    color: hio ? "#1a5a8c" : "#8c5010",
    fontSize: "10px",
    fontWeight: 600,
    padding: "5px 10px",
    borderRadius: "5px",
    cursor: "pointer",
    marginTop: "8px",
    width: "100%",
    textTransform: "uppercase",
    letterSpacing: "0.4px",
    fontFamily: "inherit",
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
