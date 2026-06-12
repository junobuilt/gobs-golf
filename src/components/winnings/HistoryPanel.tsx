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
  type WinningsTeamPayout,
} from "@/lib/payouts/loadWinnings";
import {
  overrideRoundPayout,
  revertRoundPayout,
} from "@/lib/payouts/overrideRoundPayout";
import DangerModal from "@/app/admin/components/DangerModal";

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

// Flights S3: group a round's payout rows by flight, preserving first-seen
// order. Returns a single label-less group unless the round spans 2+ distinct
// (non-null) flights — single-flight + historical (NULL flight_id) rounds render
// exactly as before.
type PayoutGroup = { key: string; label: string | null; teams: WinningsTeamPayout[] };
function groupPayoutsByFlight(teams: WinningsTeamPayout[]): PayoutGroup[] {
  const distinct = new Set(
    teams.filter((t) => t.flightId != null).map((t) => t.flightId as number),
  );
  if (distinct.size < 2) {
    return [{ key: "all", label: null, teams }];
  }
  const groups: PayoutGroup[] = [];
  const byId = new Map<number, PayoutGroup>();
  for (const t of teams) {
    const id = t.flightId as number;
    let g = byId.get(id);
    if (!g) {
      g = { key: String(id), label: t.flightName ?? `Flight ${id}`, teams: [] };
      byId.set(id, g);
      groups.push(g);
    }
    g.teams.push(t);
  }
  return groups;
}

const flightSubheaderStyle: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 800,
  color: "#475569",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  margin: "8px 0 4px",
};

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

  // S4b override/revert modal state.
  const [editing, setEditing] = useState<{
    roundId: number;
    teamNumber: number;
    mode: "override" | "revert";
    currentPerPlayer: number;
    engineAmount: number | null;
  } | null>(null);
  const [newAmount, setNewAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  // Re-fetch after a successful override/revert (no cancelled guard — the
  // modal flow owns the lifecycle).
  async function reload() {
    const data = await loadWinningsHistory(seasonId, buyIn);
    setRounds(data);
  }

  function openOverride(
    e: React.MouseEvent,
    roundId: number,
    t: WinningsTeamPayout,
  ) {
    e.stopPropagation(); // don't collapse the expanded row
    setEditing({
      roundId,
      teamNumber: t.teamNumber,
      mode: "override",
      currentPerPlayer: t.perPlayer,
      engineAmount: t.wasOverridden ? t.originalAmount : t.perPlayer,
    });
    setNewAmount(String(t.perPlayer));
    setReason("");
    setActionError(null);
  }

  function openRevert(
    e: React.MouseEvent,
    roundId: number,
    t: WinningsTeamPayout,
  ) {
    e.stopPropagation();
    setEditing({
      roundId,
      teamNumber: t.teamNumber,
      mode: "revert",
      currentPerPlayer: t.perPlayer,
      engineAmount: t.originalAmount,
    });
    setReason("");
    setActionError(null);
  }

  function closeModal() {
    setEditing(null);
    setNewAmount("");
    setReason("");
    setSubmitting(false);
    setActionError(null);
  }

  const amtNum = Number(newAmount);
  const amtValid =
    newAmount.trim() !== "" && Number.isInteger(amtNum) && amtNum >= 0;
  const confirmDisabled =
    editing?.mode === "override"
      ? reason.trim() === "" || !amtValid || submitting
      : reason.trim() === "" || submitting;

  async function confirmAction() {
    if (!editing) return;
    setSubmitting(true);
    setActionError(null);
    try {
      if (editing.mode === "override") {
        await overrideRoundPayout(
          editing.roundId,
          editing.teamNumber,
          amtNum,
          reason,
        );
      } else {
        await revertRoundPayout(editing.roundId, editing.teamNumber, reason);
      }
      await reload();
      closeModal();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Action failed. Try again.",
      );
      setSubmitting(false);
    }
  }

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
                  {r.paid > r.balance && (
                    <div style={discrepancyStyle} data-testid="payout-discrepancy">
                      ⚠ Payouts total ${r.paid} — ${r.paid - r.balance} over the
                      ${r.balance} pot. Does not reconcile (overrides are not
                      auto-rebalanced).
                    </div>
                  )}
                  <div style={subsectionHeaderStyle}>Team Payouts</div>
                  {groupPayoutsByFlight(r.teams).map((group) => (
                    <div key={group.key}>
                      {/* Flights S3: flight subheader only when the round spans
                          2+ flights; single-flight rounds render ungrouped. */}
                      {group.label && (
                        <div style={flightSubheaderStyle}>{group.label}</div>
                      )}
                      {group.teams.map((t) => {
                        const rankLabel = (t.isTied ? "T" : "") + t.place;
                        const gold = t.place === 1;
                        // Flights S5: shares this team forfeited to the blind-draw
                        // higher-of-two rule. totalForTeam is already net; show the
                        // actual paid share count + a "→ BFB" marker.
                        const paidShares = t.teamSize - t.redirectedShareCount;
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
                                ${t.perPlayer}/player × {paidShares}
                              </div>
                              {t.redirectedShareCount > 0 && (
                                <div
                                  data-testid="payout-redirect-marker"
                                  title="Blind-draw player took a higher share elsewhere; this share swept to BFB"
                                  style={{ fontSize: "9px", color: "#b45309", fontWeight: 600 }}
                                >
                                  −{t.redirectedShareCount} share{t.redirectedShareCount > 1 ? "s" : ""}{" "}
                                  (${t.perPlayer * t.redirectedShareCount}) → BFB
                                </div>
                              )}
                              {t.wasOverridden && t.originalAmount != null && (
                                <div style={{ fontSize: "9px", color: C.textMuted }}>
                                  was ${t.originalAmount}/player
                                </div>
                              )}
                              <div style={{ marginTop: "5px", display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                                <button
                                  type="button"
                                  onClick={(e) => openOverride(e, r.roundId, t)}
                                  style={editBtnStyle}
                                  data-testid="payout-edit-btn"
                                >
                                  Edit
                                </button>
                                {t.wasOverridden && (
                                  <button
                                    type="button"
                                    onClick={(e) => openRevert(e, r.roundId, t)}
                                    style={revertBtnStyle}
                                    data-testid="payout-revert-btn"
                                  >
                                    Revert
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}

      {editing && (
        <DangerModal
          title={
            editing.mode === "override"
              ? `Override Team ${editing.teamNumber} payout?`
              : `Revert Team ${editing.teamNumber} payout?`
          }
          description={
            editing.mode === "override"
              ? `Currently $${editing.currentPerPlayer}/player. Set a new per-player amount. Other teams are NOT rebalanced.`
              : `Restore the engine's original payout of $${editing.engineAmount}/player for Team ${editing.teamNumber}.`
          }
          cannotBeUndone={false}
          confirmLabel={
            submitting
              ? "Saving…"
              : editing.mode === "override"
                ? "Save override"
                : "Revert to engine value"
          }
          confirmDisabled={confirmDisabled}
          onConfirm={confirmAction}
          onCancel={closeModal}
        >
          <div style={{ textAlign: "left" }}>
            {editing.mode === "override" && (
              <>
                <label htmlFor="override-amount" style={modalLabelStyle}>
                  New per-player amount ($):
                </label>
                <input
                  id="override-amount"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  aria-label="New per-player payout"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  disabled={submitting}
                  style={modalInputStyle}
                />
              </>
            )}
            <label
              htmlFor="override-reason"
              style={{ ...modalLabelStyle, marginTop: "10px" }}
            >
              Reason (required for log):
            </label>
            <input
              id="override-reason"
              type="text"
              aria-label="Override reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                editing.mode === "override"
                  ? "e.g., side-pot correction agreed at the turn"
                  : "e.g., entered in error"
              }
              disabled={submitting}
              style={modalInputStyle}
            />
            <div style={{ marginTop: "8px", fontSize: "0.72rem", color: C.textMuted }}>
              Note: reopening this round will discard overrides.
            </div>
            {actionError && (
              <div style={{ marginTop: "6px", fontSize: "0.78rem", color: "#b91c1c" }}>
                {actionError}
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
const editBtnStyle: React.CSSProperties = {
  background: "white",
  border: `1px solid ${C.navy}`,
  color: C.navy,
  fontSize: "10px",
  fontWeight: 600,
  padding: "3px 9px",
  borderRadius: "5px",
  cursor: "pointer",
  fontFamily: "inherit",
};
const revertBtnStyle: React.CSSProperties = {
  ...editBtnStyle,
  border: "1px solid #b45309",
  color: "#b45309",
};
const discrepancyStyle: React.CSSProperties = {
  background: "#fef3c7",
  border: "1px solid #f0c869",
  color: "#92400e",
  fontSize: "11px",
  fontWeight: 600,
  borderRadius: "6px",
  padding: "6px 8px",
  marginBottom: "10px",
  lineHeight: 1.4,
};
const modalLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "#4b5563",
};
const modalInputStyle: React.CSSProperties = {
  marginTop: "6px",
  width: "100%",
  padding: "8px",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  boxSizing: "border-box",
};
