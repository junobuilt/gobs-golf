"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DangerModal from "./DangerModal";
import {
  getActiveSeason,
  listPastSeasons,
  getRoundCountForSeason,
  getInProgressRoundsForSeason,
  endSeason,
  reopenSeason,
  SeasonHasInProgressRounds,
  type Season,
  type SeasonRound,
} from "@/lib/seasons";

// H3.2 (current season + End Season) and H3.3 (past seasons + Reopen). Loads
// its own season data so it can drop into the Settings tab without threading
// props. Self-refreshes after each mutation.

const C = {
  navy: "#0c3057",
  green: "#2a7a3a",
  danger: "#c0392b",
  border: "rgba(0,0,0,0.08)",
  subtext: "#6b7280",
  font: "system-ui, sans-serif",
};

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function roundsLabel(n: number): string {
  return `${n} round${n === 1 ? "" : "s"}`;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: "0.72rem", fontWeight: 700, color: "#9ca3af",
      textTransform: "uppercase", letterSpacing: "0.06em",
      marginBottom: "12px", marginTop: "4px",
    }}>
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "white", borderRadius: "10px", border: `1px solid ${C.border}`,
      padding: "20px", marginBottom: "16px",
    }}>
      {children}
    </div>
  );
}

export default function SeasonManagement() {
  const router = useRouter();
  const [active, setActive] = useState<Season | null>(null);
  const [past, setPast] = useState<Season[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [endConfirm, setEndConfirm] = useState(false);
  const [blockRound, setBlockRound] = useState<SeasonRound | null>(null);
  const [reopenTarget, setReopenTarget] = useState<Season | null>(null);

  const load = useCallback(async () => {
    const [a, p] = await Promise.all([getActiveSeason(), listPastSeasons()]);
    setActive(a);
    setPast(p);
    const all = a ? [a, ...p] : p;
    const entries = await Promise.all(
      all.map(async (s) => [s.id, await getRoundCountForSeason(s.id)] as const),
    );
    setCounts(Object.fromEntries(entries));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // End Season — pre-check in-progress rounds to pick the right modal.
  const onEndClick = async () => {
    if (!active || busy) return;
    const inProgress = await getInProgressRoundsForSeason(active.id);
    if (inProgress.length > 0) {
      setBlockRound(inProgress[0]);
      return;
    }
    setEndConfirm(true);
  };

  const doEnd = async () => {
    if (!active) return;
    setBusy(true);
    try {
      await endSeason(active.id);
      setEndConfirm(false);
      await load();
    } catch (e) {
      // Defense-in-depth: a round may have started between the pre-check and
      // confirm. Swap the confirm modal for the block modal.
      if (e instanceof SeasonHasInProgressRounds) {
        setEndConfirm(false);
        setBlockRound(e.rounds[0]);
      } else {
        alert("Couldn't end season: " + (e instanceof Error ? e.message : String(e)));
      }
    } finally {
      setBusy(false);
    }
  };

  const doReopen = async () => {
    if (!reopenTarget) return;
    setBusy(true);
    try {
      await reopenSeason(reopenTarget.id);
      setReopenTarget(null);
      await load();
    } catch {
      // The partial unique index rejects a concurrent reopen — generic retry.
      alert("Couldn't reopen season — another change may have happened. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionHeader>Current Season</SectionHeader>
      <Card>
        {loading ? (
          <div style={{ color: "#9ca3af", fontSize: "0.85rem" }}>Loading…</div>
        ) : active ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
            <div>
              <div data-testid="current-season-name" style={{ fontSize: "1rem", fontWeight: 700, color: "#1f2937" }}>
                {active.name}
              </div>
              <div style={{ fontSize: "0.8rem", color: C.subtext, marginTop: "3px" }}>
                Started {fmtDate(active.started_on)} · {roundsLabel(counts[active.id] ?? 0)} played
              </div>
            </div>
            <button
              onClick={onEndClick}
              disabled={busy}
              style={{
                flexShrink: 0, padding: "9px 16px", borderRadius: "8px",
                border: `1.5px solid ${C.danger}`, background: "white",
                color: C.danger, fontSize: "0.85rem", fontWeight: 700,
                cursor: busy ? "default" : "pointer", fontFamily: C.font,
              }}
            >
              End Season
            </button>
          </div>
        ) : (
          <div style={{ color: C.subtext, fontSize: "0.85rem", lineHeight: 1.5 }}>
            No active season. Creating a round will prompt you to start one.
          </div>
        )}
      </Card>

      <SectionHeader>Past Seasons</SectionHeader>
      <Card>
        {loading ? (
          <div style={{ color: "#9ca3af", fontSize: "0.85rem" }}>Loading…</div>
        ) : past.length === 0 ? (
          <div style={{ color: C.subtext, fontSize: "0.85rem" }}>No past seasons yet.</div>
        ) : (
          past.map((s, i) => (
            <div
              key={s.id}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                gap: "12px", padding: "12px 0",
                borderBottom: i === past.length - 1 ? "none" : `1px solid ${C.border}`,
              }}
            >
              <div>
                <div style={{ fontSize: "0.92rem", fontWeight: 600, color: "#1f2937" }}>{s.name}</div>
                <div style={{ fontSize: "0.78rem", color: C.subtext, marginTop: "2px" }}>
                  {fmtDate(s.started_on)} – {fmtDate(s.ended_on)} · {roundsLabel(counts[s.id] ?? 0)}
                </div>
              </div>
              <button
                onClick={() => setReopenTarget(s)}
                disabled={busy}
                style={{
                  flexShrink: 0, padding: "8px 14px", borderRadius: "8px",
                  border: `1.5px solid #d1d5db`, background: "white",
                  color: C.navy, fontSize: "0.82rem", fontWeight: 700,
                  cursor: busy ? "default" : "pointer", fontFamily: C.font,
                }}
              >
                Reopen
              </button>
            </div>
          ))
        )}
      </Card>

      {/* End Season confirm (reversible via Reopen, so not "cannot be undone") */}
      {endConfirm && active && (
        <DangerModal
          title={`End ${active.name}?`}
          description={`This locks all ${roundsLabel(counts[active.id] ?? 0)}. New rounds will need a fresh season.`}
          cannotBeUndone={false}
          confirmLabel="End Season"
          onConfirm={doEnd}
          onCancel={() => setEndConfirm(false)}
        />
      )}

      {/* In-progress block modal — informational, with a Go to Round action */}
      {blockRound && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: "24px",
        }}>
          <div style={{
            background: "white", borderRadius: "16px", padding: "28px 24px",
            maxWidth: "420px", width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          }}>
            <h2 style={{ margin: "0 0 10px", fontSize: "1.15rem", fontWeight: 700, color: C.navy }}>
              Round in progress
            </h2>
            <p style={{ margin: "0 0 24px", fontSize: "0.9rem", color: "#4b5563", lineHeight: 1.5 }}>
              Round on {fmtDate(blockRound.played_on)} is in progress. Finalize it before ending the season.
            </p>
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                onClick={() => setBlockRound(null)}
                style={{
                  flex: 1, padding: "13px", borderRadius: "10px",
                  border: "1.5px solid #d1d5db", background: "white",
                  fontSize: "0.95rem", fontWeight: 600, color: "#374151",
                  cursor: "pointer", fontFamily: C.font,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => router.push(`/round/${blockRound.id}/scorecard`)}
                style={{
                  flex: 1, padding: "13px", borderRadius: "10px", border: "none",
                  background: C.navy, color: "white",
                  fontSize: "0.95rem", fontWeight: 700, cursor: "pointer", fontFamily: C.font,
                }}
              >
                Go to Round
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reopen confirm — copy adjusts when there's a currently-active season */}
      {reopenTarget && (
        <DangerModal
          title={`Reopen ${reopenTarget.name}?`}
          description={
            active && active.id !== reopenTarget.id
              ? `This will pause the currently active season (${active.name} — ${roundsLabel(counts[active.id] ?? 0)}). You can switch back when finished.`
              : `It will become active.`
          }
          cannotBeUndone={false}
          confirmLabel="Reopen"
          onConfirm={doReopen}
          onCancel={() => setReopenTarget(null)}
        />
      )}
    </>
  );
}
