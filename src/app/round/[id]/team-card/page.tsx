"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Format, FormatConfig } from "@/lib/scoring/types";
import { isTeamCardFormat, getTeamBallCount } from "@/lib/format/helpers";
import {
  buildTeamScoreMap,
  getTeamHoleTotal,
  holesScoredForTeam,
  getTeamTotal,
  type TeamScoreRow,
} from "@/lib/round/teamScores";
import { loadTeamScores, upsertTeamScore } from "@/lib/round/teamScoresIo";
import FormatChip from "@/components/format/FormatChip";
import PlayerHoleGrid from "@/components/scorecard/PlayerHoleGrid";
import TeamHoleEntry from "@/components/scorecard/TeamHoleEntry";

// Wave 1B — team-card scorecard surface (Shambles). The TEAM enters one score
// per hole (count-1) or two summed balls (count-2). Separate surface from the
// individual scorecard; team scores live in `team_scores`, NOT `scores`.
//
// C2 scope = entry only. Submit Final Scores + finalize is C4; homepage routing
// + adding shambles to FORMAT_ORDER is C3. Reached by direct URL in C2.

type HoleInfo = { hole_number: number; par: number; yardage: number | null; stroke_index: number };

const NAVY = "#0c3057";

export default function TeamCardPage() {
  const params = useParams();
  const roundId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [roundFormat, setRoundFormat] = useState<Format | null>(null);
  const [roundFormatConfig, setRoundFormatConfig] = useState<FormatConfig | null>(null);
  const [roundFormatLockedAt, setRoundFormatLockedAt] = useState<string | null>(null);
  const [isRoundComplete, setIsRoundComplete] = useState(false);
  const [rosterDisplay, setRosterDisplay] = useState<string>("");
  const [holes, setHoles] = useState<HoleInfo[]>([]);
  // hole_number -> ball_index -> strokes
  const [balls, setBalls] = useState<Record<number, Record<number, number>>>({});
  const [currentHole, setCurrentHole] = useState(1);
  const [expanded, setExpanded] = useState(false);

  const teamNumber = teamFilter ? parseInt(teamFilter, 10) : null;
  const ballCount = getTeamBallCount(roundFormatConfig);

  useEffect(() => {
    const load = async () => {
      const team = new URLSearchParams(window.location.search).get("team");
      setTeamFilter(team);

      const { data: roundRow } = await supabase
        .from("rounds")
        .select("format, format_config, format_locked_at, is_complete")
        .eq("id", roundId)
        .maybeSingle();

      const fmt = (roundRow?.format ?? null) as Format | null;
      const cfg = (roundRow?.format_config ?? null) as FormatConfig | null;
      setRoundFormat(fmt);
      setRoundFormatConfig(cfg);
      setRoundFormatLockedAt((roundRow?.format_locked_at ?? null) as string | null);
      setIsRoundComplete(!!roundRow?.is_complete);

      if (team && isTeamCardFormat(fmt)) {
        const teamNum = parseInt(team, 10);

        const { data: rp } = await supabase
          .from("round_players")
          .select("tee_id, players ( full_name, display_name )")
          .eq("round_id", roundId)
          .eq("team_number", teamNum)
          .order("id");
        const roster = (rp ?? []) as Array<{ tee_id: number | null; players: any }>;
        setRosterDisplay(
          roster
            .map((r) => {
              const p = Array.isArray(r.players) ? r.players[0] : r.players;
              return p?.display_name || p?.full_name || "";
            })
            .filter(Boolean)
            .join(", "),
        );

        // Representative tee for par/yardage. Par is consistent across tees
        // (only yardage / stroke index differ), so any roster member's tee
        // gives the right par for the team's gross hole total.
        const teeId = roster.find((r) => r.tee_id != null)?.tee_id ?? null;
        if (teeId != null) {
          const { data: h } = await supabase
            .from("holes")
            .select("hole_number, par, yardage, stroke_index")
            .eq("tee_id", teeId)
            .order("hole_number");
          setHoles((h ?? []) as HoleInfo[]);
        }

        const rows: TeamScoreRow[] = await loadTeamScores(Number(roundId));
        const map: Record<number, Record<number, number>> = {};
        for (const r of rows) {
          if (r.team_number !== teamNum) continue;
          if (!map[r.hole_number]) map[r.hole_number] = {};
          map[r.hole_number][r.ball_index] = r.strokes;
        }
        setBalls(map);
      }

      setLoading(false);
    };
    void load();
  }, [roundId]);

  const ensureFormatLocked = async () => {
    if (roundFormatLockedAt !== null) return;
    const { data } = await supabase
      .from("rounds")
      .update({ format_locked_at: new Date().toISOString() })
      .eq("id", roundId)
      .is("format_locked_at", null)
      .select("format_locked_at")
      .maybeSingle();
    if (data?.format_locked_at) setRoundFormatLockedAt(data.format_locked_at as string);
  };

  const onSet = (ballIndex: number, value: number) => {
    if (isRoundComplete || teamNumber == null) return;
    // Optimistic update; the upsert persists last-write-wins per box.
    setBalls((prev) => ({
      ...prev,
      [currentHole]: { ...prev[currentHole], [ballIndex]: value },
    }));
    void upsertTeamScore({
      round_id: Number(roundId),
      team_number: teamNumber,
      hole_number: currentHole,
      ball_index: ballIndex,
      strokes: value,
    }).catch((e) => console.warn("[team-card] upsert failed", e));
    void ensureFormatLocked();
  };

  if (loading) {
    return <div style={{ padding: "40px", textAlign: "center", fontFamily: "sans-serif", color: "#64748b" }}>Loading…</div>;
  }

  if (!teamFilter) {
    return (
      <div style={{ padding: "40px 20px", maxWidth: "500px", margin: "0 auto", textAlign: "center", fontFamily: "sans-serif" }}>
        <p style={{ fontWeight: 700, color: NAVY }}>No team selected</p>
        <p style={{ color: "#64748b", fontSize: "0.85rem" }}>Open this card from your team on the home screen.</p>
      </div>
    );
  }

  if (!isTeamCardFormat(roundFormat)) {
    return (
      <div style={{ padding: "40px 20px", maxWidth: "500px", margin: "0 auto", textAlign: "center", fontFamily: "sans-serif" }}>
        <p style={{ fontWeight: 700, color: NAVY }}>Not a team-card round</p>
        <p style={{ color: "#64748b", fontSize: "0.85rem" }}>This round uses an individual scorecard.</p>
      </div>
    );
  }

  const holeInfo = holes.find((h) => h.hole_number === currentHole);
  const par = holeInfo?.par ?? 4;
  // Current hole's balls as a positional array (length ballCount) for the entry control.
  const currentBalls: (number | undefined)[] = Array.from(
    { length: ballCount },
    (_, i) => balls[currentHole]?.[i + 1],
  );

  const scoreMap = buildTeamScoreMap(
    Object.entries(balls).flatMap(([hole, byBall]) =>
      Object.entries(byBall).map(([bi, strokes]) => ({
        team_number: teamNumber!,
        hole_number: Number(hole),
        ball_index: Number(bi),
        strokes,
      })),
    ),
  );
  const thru = holesScoredForTeam(scoreMap, teamNumber!);
  const grossTotal = getTeamTotal(scoreMap, teamNumber!);
  const parScored = holes
    .filter((h) => getTeamHoleTotal(scoreMap, teamNumber!, h.hole_number) != null)
    .reduce((s, h) => s + h.par, 0);
  const delta = grossTotal - parScored;
  const deltaLabel = thru === 0 ? "—" : delta === 0 ? "E" : delta > 0 ? `+${delta}` : `−${-delta}`;

  // 18-length arrays for the read-only hole-by-hole grid.
  const gridScores: (number | null)[] = Array.from({ length: 18 }, (_, i) =>
    getTeamHoleTotal(scoreMap, teamNumber!, i + 1),
  );
  const gridPar: number[] = Array.from(
    { length: 18 },
    (_, i) => holes.find((h) => h.hole_number === i + 1)?.par ?? 4,
  );

  return (
    <div style={{ padding: "15px", maxWidth: "500px", margin: "0 auto", fontFamily: "sans-serif", paddingBottom: "160px" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "15px" }}>
        <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 900, color: NAVY }}>TEAM {teamFilter}</p>
        {rosterDisplay && (
          <p style={{ margin: "2px 0 8px", fontSize: "0.72rem", color: "#64748b" }}>{rosterDisplay}</p>
        )}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
          {roundFormat && (
            // Read-only chip (no onChange) — format can't be switched from the
            // team card mid-entry.
            <FormatChip
              roundId={Number(roundId)}
              currentFormat={roundFormat}
              currentConfig={roundFormatConfig}
              formatLocked={roundFormatLockedAt !== null}
            />
          )}
        </div>
        <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b", marginBottom: "4px" }}>
          {ballCount === 2 ? "2 balls per hole" : "1 ball per hole"}
        </div>
        {/* Team-card is gross only — no per-player handicap to apply. Replaces
            the individual card's "Handicaps at N%" allowance caption. */}
        <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#c2410c", letterSpacing: "0.02em", marginBottom: "8px" }}>
          Gross only — no handicap
        </div>
        <div style={{ fontSize: "2.2rem", fontWeight: 900 }}>Hole {currentHole}</div>
        <p style={{ opacity: 0.5, fontSize: "0.75rem", fontWeight: "bold" }}>
          PAR {holeInfo?.par || "?"} • {holeInfo?.yardage || "?"} YDS
        </p>
        {isRoundComplete && (
          <div style={{
            marginTop: 8, display: "inline-block", background: "#dcfce7", color: "#166534",
            border: "1px solid #bbf7d0", padding: "4px 12px", borderRadius: 999,
            fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
          }}>
            Round complete
          </div>
        )}
      </div>

      {/* Team total summary */}
      <div style={{
        display: "flex", justifyContent: "center", gap: "24px", marginBottom: "16px",
        padding: "12px", background: "#fff", border: "0.5px solid #e4e4e4", borderRadius: "10px",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "0.65rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>Team</div>
          <div data-testid="summary-delta" style={{ fontSize: "1.5rem", fontWeight: 900, color: NAVY }}>{deltaLabel}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "0.65rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>Thru</div>
          <div data-testid="summary-thru" style={{ fontSize: "1.5rem", fontWeight: 900, color: NAVY }}>{thru}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "0.65rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>Gross</div>
          <div data-testid="summary-gross" style={{ fontSize: "1.5rem", fontWeight: 900, color: NAVY }}>{thru === 0 ? "—" : grossTotal}</div>
        </div>
      </div>

      {/* Hole navigation dots */}
      <div style={{ display: "flex", overflowX: "auto", gap: "6px", marginBottom: "20px", paddingBottom: "10px", touchAction: "pan-x" }}>
        {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => {
          const hasScores = balls[h] != null && Object.keys(balls[h]).length > 0;
          return (
            <button key={h} onClick={() => setCurrentHole(h)} style={{
              minWidth: "44px", height: "44px", borderRadius: "50%",
              border: h === currentHole ? `2px solid ${NAVY}` : "1px solid #e2e8f0",
              background: h === currentHole ? NAVY : hasScores ? "#dbeafe" : "white",
              color: h === currentHole ? "white" : hasScores ? "#1e40af" : "#94a3b8",
              fontSize: "0.8rem", fontWeight: "bold", cursor: "pointer", touchAction: "manipulation",
            }}>
              {h}
            </button>
          );
        })}
      </div>

      {/* Entry */}
      <div style={{ padding: "16px", background: "#fff", border: "0.5px solid #e4e4e4", borderRadius: "10px", marginBottom: "16px" }}>
        <TeamHoleEntry
          ballCount={ballCount}
          balls={currentBalls}
          par={par}
          disabled={isRoundComplete}
          onSet={onSet}
        />
      </div>

      {/* Read-only hole-by-hole (team row) */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #e2e8f0",
          background: "#f8fafc", color: "#64748b", fontWeight: 700, fontSize: "0.8rem",
          cursor: "pointer", fontFamily: "sans-serif", marginBottom: "12px",
        }}
      >
        {expanded ? "Hide hole-by-hole" : "Show hole-by-hole"}
      </button>
      {expanded && (
        <div style={{ marginBottom: "16px" }}>
          <PlayerHoleGrid scores={gridScores} par={gridPar} currentHoleIndex={currentHole - 1} />
        </div>
      )}

      {/* Hole nav buttons */}
      <div style={{ display: "flex", gap: "10px" }}>
        <button
          onClick={() => setCurrentHole((h) => Math.max(1, h - 1))}
          disabled={currentHole === 1}
          style={{
            flex: 1, padding: "14px", borderRadius: "10px", border: "1px solid #e2e8f0",
            background: "#fff", color: currentHole === 1 ? "#cbd5e1" : NAVY, fontWeight: 700,
            cursor: currentHole === 1 ? "default" : "pointer", fontFamily: "sans-serif",
          }}
        >
          ← Back
        </button>
        <button
          onClick={() => setCurrentHole((h) => Math.min(18, h + 1))}
          disabled={currentHole === 18}
          style={{
            flex: 1, padding: "14px", borderRadius: "10px", border: "none",
            background: currentHole === 18 ? "#cbd5e1" : NAVY, color: "white", fontWeight: 700,
            cursor: currentHole === 18 ? "default" : "pointer", fontFamily: "sans-serif",
          }}
        >
          Next Hole →
        </button>
      </div>
    </div>
  );
}
