"use client";

// Phase 4 — admin override panel for one day's matches (Levels 1 & 2).
// Level 2 (match result): force a winner/half — even with zero scores (envelope
// rule); reversible to the engine. Level 1 (hole result): correct a player's
// strokes on one hole and let the engine recompute the outcome canonically.
// Reads the canonical loadSessionMatches; writes go through the additive
// mutations (setMatchHoleScore / overrideMatchResult / revertMatchResult) — it
// never touches the scorer scorecard surface or matchplay.ts.

import { useCallback, useEffect, useState } from "react";
import { getTeamColor } from "@/lib/teamColors";
import { loadSessionMatches } from "@/lib/tournament/loadMatch";
import { matchStatusLine } from "@/lib/tournament/dashboardFormat";
import {
  overrideMatchResult,
  revertMatchResult,
  setMatchHoleScore,
  setMatchTeamHoleScore,
} from "@/lib/tournament/mutations";
import type { LoadedMatch, MatchResult, Tournament, TournamentSession } from "@/lib/tournament/types";

const C = {
  navy: "#0c3057",
  green: "#2a7a3a",
  red: "#a32d2d",
  amber: "#92400e",
  amberBg: "#fef3c7",
  border: "rgba(0,0,0,0.10)",
  muted: "#6b7280",
};
const FONT = "system-ui, sans-serif";
const SIDE_COLOR = { a: getTeamColor(4).pillText, b: getTeamColor(6).pillText };

const inputStyle: React.CSSProperties = {
  padding: "9px 10px",
  borderRadius: 8,
  border: `1.5px solid ${C.border}`,
  fontSize: "0.9rem",
  fontFamily: FONT,
  minHeight: 40,
  boxSizing: "border-box",
};

export default function MatchOverridePanel({
  session,
  tournament,
  onClose,
}: {
  session: TournamentSession;
  tournament: Tournament;
  onClose: () => void;
}) {
  const [matches, setMatches] = useState<LoadedMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setMatches(await loadSessionMatches(session.id));
    } catch {
      setMatches([]);
      setError("Couldn’t load this day’s matches.");
    }
  }, [session.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (fn: () => Promise<void>, failMsg: string) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : failMsg);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "flex-start", overflowY: "auto", padding: 16 }}>
      <div data-testid="override-panel" style={{ background: "#f5f4f0", borderRadius: 14, maxWidth: 560, width: "100%", margin: "24px 0", padding: 18, fontFamily: FONT }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 800, color: C.navy, fontSize: "1.05rem" }}>Results &amp; overrides — {session.name}</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "white", border: `1.5px solid ${C.border}`, borderRadius: 8, minWidth: 40, minHeight: 40, fontWeight: 700, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ fontSize: "0.8rem", color: C.muted, marginBottom: 12 }}>
          Use this panel to override scores/results — changes override the scoring engine.
        </div>

        {error && (
          <div role="alert" style={{ background: "#fdecec", border: `1px solid ${C.red}`, color: C.red, borderRadius: 8, padding: "8px 10px", marginBottom: 10, fontSize: "0.82rem", fontWeight: 600 }}>
            {error}
          </div>
        )}

        {matches == null ? (
          <div style={{ color: C.muted, fontSize: "0.85rem", padding: 12 }}>Loading…</div>
        ) : matches.length === 0 ? (
          <div style={{ color: C.muted, fontSize: "0.85rem", padding: 12 }}>No matches on this day yet.</div>
        ) : (
          matches.map((m) => (
            <MatchCard key={m.match.id} m={m} tournament={tournament} busy={busy} run={run} />
          ))
        )}
      </div>
    </div>
  );
}

function MatchCard({
  m,
  tournament,
  busy,
  run,
}: {
  m: LoadedMatch;
  tournament: Tournament;
  busy: boolean;
  run: (fn: () => Promise<void>, failMsg: string) => Promise<void>;
}) {
  const status = matchStatusLine(m);
  const [note, setNote] = useState(m.match.admin_note ?? "");
  const aNames = m.sideA.players.map((p) => p.displayName).join(" / ") || tournament.side_a_name;
  const bNames = m.sideB.players.map((p) => p.displayName).join(" / ") || tournament.side_b_name;
  const isGreensomes = m.session.format === "greensomes";

  const resultBtn = (label: string, result: MatchResult, sideColor?: string) => {
    const active = m.match.result_source === "admin" && m.match.result === result;
    return (
      <button
        data-testid={`force-${result}-${m.match.id}`}
        disabled={busy}
        onClick={() => run(() => overrideMatchResult(m.match.id, result, note), "Couldn’t set the result.")}
        style={{
          flex: 1,
          minHeight: 42,
          borderRadius: 8,
          border: `1.5px solid ${active ? C.navy : C.border}`,
          background: active ? "#eef2f7" : "white",
          color: sideColor ?? C.navy,
          fontWeight: 700,
          fontSize: "0.82rem",
          cursor: busy ? "default" : "pointer",
          fontFamily: FONT,
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div data-testid={`override-match-${m.match.id}`} style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: "0.92rem", fontWeight: 600 }}>
          <span style={{ color: SIDE_COLOR.a }}>{aNames}</span>
          <span style={{ color: "#9ca3af", margin: "0 6px" }}>v</span>
          <span style={{ color: SIDE_COLOR.b }}>{bNames}</span>
        </span>
        <span data-testid={`override-status-${m.match.id}`} style={{ fontSize: "0.78rem", fontWeight: 700, color: status.decided ? C.navy : C.muted, whiteSpace: "nowrap" }}>
          {status.text}
          {status.adminForced && <span style={{ marginLeft: 5, fontSize: "0.62rem", fontWeight: 800, color: C.amber, background: C.amberBg, borderRadius: 4, padding: "1px 4px", textTransform: "uppercase" }}>admin</span>}
        </span>
      </div>

      {/* Level 2 — force the match result. */}
      <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Force result</div>
      <div style={{ display: "flex", gap: 8 }}>
        {resultBtn(`${tournament.side_a_name} win`, "side_a", SIDE_COLOR.a)}
        {resultBtn("Halved", "halved")}
        {resultBtn(`${tournament.side_b_name} win`, "side_b", SIDE_COLOR.b)}
      </div>
      <input
        data-testid={`override-note-${m.match.id}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Reason / note (optional)"
        style={{ ...inputStyle, width: "100%", marginTop: 8 }}
      />
      {m.match.result_source === "admin" && (
        <button
          data-testid={`revert-${m.match.id}`}
          disabled={busy}
          onClick={() => run(() => revertMatchResult(m.match.id), "Couldn’t revert to the engine.")}
          style={{ marginTop: 8, background: "transparent", border: "none", color: "#1a5a8c", fontWeight: 700, cursor: "pointer", fontSize: "0.8rem", padding: 0 }}
        >
          Revert to engine result
        </button>
      )}

      {/* Level 1 — correct a hole. Greensomes plays one ball per side, so the
          correctable value is the SIDE's team score (team_scores), not a player's;
          individual formats correct a player's strokes (scores). */}
      {isGreensomes ? (
        <GreensomesHoleCorrection m={m} busy={busy} run={run} />
      ) : (
        <HoleCorrection m={m} busy={busy} run={run} />
      )}
    </div>
  );
}

function HoleCorrection({
  m,
  busy,
  run,
}: {
  m: LoadedMatch;
  busy: boolean;
  run: (fn: () => Promise<void>, failMsg: string) => Promise<void>;
}) {
  const players = [...m.sideA.players, ...m.sideB.players];
  const [rpId, setRpId] = useState<number>(players[0]?.roundPlayerId ?? 0);
  const [hole, setHole] = useState<number>(1);
  const [strokes, setStrokes] = useState<string>("");

  const canSave = rpId > 0 && Number.isInteger(Number(strokes)) && Number(strokes) >= 1;

  return (
    <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
      <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Correct a hole</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select data-testid={`hole-player-${m.match.id}`} value={rpId} onChange={(e) => setRpId(Number(e.target.value))} style={{ ...inputStyle, flex: "1 1 130px" }}>
          {players.map((p) => (
            <option key={p.roundPlayerId} value={p.roundPlayerId}>{p.displayName}</option>
          ))}
        </select>
        <select data-testid={`hole-number-${m.match.id}`} value={hole} onChange={(e) => setHole(Number(e.target.value))} style={{ ...inputStyle, flex: "0 0 90px" }}>
          {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => (
            <option key={h} value={h}>Hole {h}</option>
          ))}
        </select>
        <input
          data-testid={`hole-strokes-${m.match.id}`}
          type="number"
          min={1}
          value={strokes}
          onChange={(e) => setStrokes(e.target.value)}
          placeholder="Strokes"
          style={{ ...inputStyle, flex: "0 0 80px" }}
        />
        <button
          data-testid={`hole-save-${m.match.id}`}
          disabled={busy || !canSave}
          onClick={() => run(() => setMatchHoleScore(rpId, hole, Number(strokes)), "Couldn’t save that score.")}
          style={{ minHeight: 40, padding: "0 14px", borderRadius: 8, border: "none", background: canSave ? C.green : "#e5e7eb", color: canSave ? "white" : "#9ca3af", fontWeight: 700, fontSize: "0.82rem", cursor: canSave && !busy ? "pointer" : "default", fontFamily: FONT }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// Greensomes (Day 1, alternate shot) hole correction. One ball per side → the
// admin picks a SIDE (not a player), a hole, and the corrected team strokes. The
// strokes input PREFILLS the current team score for the chosen side/hole so Dad
// sees the value he's changing. Writes through setMatchTeamHoleScore → the SAME
// team_scores upsert (ball_index 1) the live Day-1 scorecard uses, so the engine
// recomputes the greensomes outcome canonically on the panel's reload.
function GreensomesHoleCorrection({
  m,
  busy,
  run,
}: {
  m: LoadedMatch;
  busy: boolean;
  run: (fn: () => Promise<void>, failMsg: string) => Promise<void>;
}) {
  const sides = [
    { teamNumber: m.sideA.teamNumber, label: m.sideA.players.map((p) => p.displayName).join(" / ") || m.sideA.displayName, teamGross: m.sideA.teamGross },
    { teamNumber: m.sideB.teamNumber, label: m.sideB.players.map((p) => p.displayName).join(" / ") || m.sideB.displayName, teamGross: m.sideB.teamGross },
  ];
  const [teamNumber, setTeamNumber] = useState<number>(sides[0]?.teamNumber ?? 0);
  const [hole, setHole] = useState<number>(1);
  const [strokes, setStrokes] = useState<string>("");

  // Prefill the current team score for the selected side + hole (blank when none
  // entered yet). Re-syncs when the side/hole changes and when `m` reloads after a
  // save, so the input always mirrors the stored value.
  const currentStrokes = sides.find((s) => s.teamNumber === teamNumber)?.teamGross?.[hole - 1] ?? null;
  useEffect(() => {
    setStrokes(currentStrokes == null ? "" : String(currentStrokes));
  }, [currentStrokes]);

  const roundId = m.session.roundId;
  const canSave = roundId != null && teamNumber > 0 && Number.isInteger(Number(strokes)) && Number(strokes) >= 1;

  return (
    <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
      <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Correct a hole</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select data-testid={`gs-hole-team-${m.match.id}`} value={teamNumber} onChange={(e) => setTeamNumber(Number(e.target.value))} style={{ ...inputStyle, flex: "1 1 130px" }}>
          {sides.map((s) => (
            <option key={s.teamNumber} value={s.teamNumber}>{s.label}</option>
          ))}
        </select>
        <select data-testid={`gs-hole-number-${m.match.id}`} value={hole} onChange={(e) => setHole(Number(e.target.value))} style={{ ...inputStyle, flex: "0 0 90px" }}>
          {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => (
            <option key={h} value={h}>Hole {h}</option>
          ))}
        </select>
        <input
          data-testid={`gs-hole-strokes-${m.match.id}`}
          type="number"
          min={1}
          value={strokes}
          onChange={(e) => setStrokes(e.target.value)}
          placeholder="Strokes"
          style={{ ...inputStyle, flex: "0 0 80px" }}
        />
        <button
          data-testid={`gs-hole-save-${m.match.id}`}
          disabled={busy || !canSave}
          onClick={() => run(() => setMatchTeamHoleScore(roundId as number, teamNumber, hole, Number(strokes)), "Couldn’t save that score.")}
          style={{ minHeight: 40, padding: "0 14px", borderRadius: 8, border: "none", background: canSave ? C.green : "#e5e7eb", color: canSave ? "white" : "#9ca3af", fontWeight: 700, fontSize: "0.82rem", cursor: canSave && !busy ? "pointer" : "default", fontFamily: FONT }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
