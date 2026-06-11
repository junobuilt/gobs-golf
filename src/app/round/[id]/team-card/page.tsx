"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Format, FormatConfig } from "@/lib/scoring/types";
import { isTeamCardFormat, getTeamBallCount } from "@/lib/format/helpers";
import { getPrimaryFlightForRound } from "@/lib/flights/resolve";
import { computeTeamHandicap } from "@/lib/scoring/teamHandicap";
import {
  buildTeamScoreMap,
  getTeamHoleTotal,
  holesScoredForTeam,
  getTeamTotal,
  type TeamScoreRow,
} from "@/lib/round/teamScores";
import { loadTeamScores, upsertTeamScore } from "@/lib/round/teamScoresIo";
import { computeAndPersistRoundPayouts } from "@/lib/payouts/persistRoundPayouts";
import DangerModal from "@/app/admin/components/DangerModal";
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

// G2: persist payouts after a team-card round finalizes. Non-fatal — the round
// is already complete; re-running heals a failure (the RPC is idempotent).
async function persistPayoutsAfterFinalize(roundId: number): Promise<void> {
  try {
    await computeAndPersistRoundPayouts(roundId);
  } catch (e) {
    console.warn("[G2] payout persistence failed (round finalized; recoverable)", e);
  }
}

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
  // This team's members' raw (full) course handicaps, for the team-handicap
  // deduction. Phase 1C — NET team-card formats.
  const [teamCourseHandicaps, setTeamCourseHandicaps] = useState<(number | null)[]>([]);
  const [holes, setHoles] = useState<HoleInfo[]>([]);
  // hole_number -> ball_index -> strokes
  const [balls, setBalls] = useState<Record<number, Record<number, number>>>({});
  const [currentHole, setCurrentHole] = useState(1);
  const [expanded, setExpanded] = useState(false);

  // Phase 1C — per-team submission gate (ported from the individual scorecard).
  // Each team taps Submit Final Scores; finalize_round_team_card fires once every
  // team in the round appears in `submittedTeams`.
  const [submittedTeams, setSubmittedTeams] = useState<number[]>([]);
  const [allTeamNumbers, setAllTeamNumbers] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitModal, setSubmitModal] = useState(false);
  const [allSubmittedRpcInFlight, setAllSubmittedRpcInFlight] = useState(false);

  const teamNumber = teamFilter ? parseInt(teamFilter, 10) : null;
  const ballCount = getTeamBallCount(roundFormatConfig);
  const teamSize = teamCourseHandicaps.length;
  const teamHandicap = roundFormat
    ? computeTeamHandicap(roundFormat, teamCourseHandicaps)
    : null;

  useEffect(() => {
    const load = async () => {
      const team = new URLSearchParams(window.location.search).get("team");
      setTeamFilter(team);

      // Format / config / lock live on the round's primary flight (Session 1);
      // the round row supplies lifecycle + the ROUND-level submitted_teams gate.
      const { data: roundRow } = await supabase
        .from("rounds")
        .select("format_config, is_complete")
        .eq("id", roundId)
        .maybeSingle();
      const flight = await getPrimaryFlightForRound(Number(roundId));

      const roundCfg = (roundRow?.format_config ?? null) as FormatConfig | null;
      const fmt = (flight?.format ?? null) as Format | null;
      const cfg = (flight?.format_config ?? null) as FormatConfig | null;
      setRoundFormat(fmt);
      setRoundFormatConfig(cfg);
      setRoundFormatLockedAt((flight?.format_locked_at ?? null) as string | null);
      setIsRoundComplete(!!roundRow?.is_complete);
      // submitted_teams stays ROUND-level (frozen rounds.format_config).
      setSubmittedTeams(Array.isArray(roundCfg?.submitted_teams) ? roundCfg!.submitted_teams! : []);

      // All assigned team numbers in this round — the finalize gate needs every
      // team to have submitted, not just this one.
      const { data: allRp } = await supabase
        .from("round_players")
        .select("team_number")
        .eq("round_id", roundId)
        .gt("team_number", 0);
      const teamSet = new Set<number>(
        (allRp ?? []).map((r: any) => r.team_number as number),
      );
      setAllTeamNumbers(Array.from(teamSet).sort((a, b) => a - b));

      if (team && isTeamCardFormat(fmt)) {
        const teamNum = parseInt(team, 10);

        const { data: rp } = await supabase
          .from("round_players")
          .select("tee_id, course_handicap, players ( full_name, display_name )")
          .eq("round_id", roundId)
          .eq("team_number", teamNum)
          .order("id");
        const roster = (rp ?? []) as Array<{ tee_id: number | null; course_handicap: number | null; players: any }>;
        setRosterDisplay(
          roster
            .map((r) => {
              const p = Array.isArray(r.players) ? r.players[0] : r.players;
              return p?.display_name || p?.full_name || "";
            })
            .filter(Boolean)
            .join(", "),
        );
        setTeamCourseHandicaps(roster.map((r) => r.course_handicap ?? null));

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

  // Phase 1C: fire finalize once every team has submitted (ported from the
  // individual scorecard). Re-runs whenever submittedTeams changes (my own
  // submit, or another team's submit picked up by refreshSubmittedTeams).
  useEffect(() => {
    if (isRoundComplete) return;
    if (allTeamNumbers.length === 0) return;
    if (!allTeamNumbers.every((t) => submittedTeams.includes(t))) return;
    void tryFinalizeIfAllSubmitted();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submittedTeams, allTeamNumbers, isRoundComplete]);

  // Append my team to format_config.submitted_teams (read-modify-write; the
  // league plays in person so submissions are essentially serial).
  const submitTeam = async (teamNum: number) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const { data: row } = await supabase
        .from("rounds")
        .select("format_config")
        .eq("id", roundId)
        .maybeSingle();
      const currentCfg = (row?.format_config ?? roundFormatConfig ?? {}) as FormatConfig & Record<string, unknown>;
      const existing: number[] = Array.isArray(currentCfg.submitted_teams)
        ? (currentCfg.submitted_teams as number[])
        : [];
      if (existing.includes(teamNum)) {
        setSubmittedTeams(existing);
        return;
      }
      const nextSubmitted = [...existing, teamNum].sort((a, b) => a - b);
      const nextCfg = { ...currentCfg, submitted_teams: nextSubmitted };
      const { error } = await supabase
        .from("rounds")
        .update({ format_config: nextCfg })
        .eq("id", roundId);
      if (error) {
        console.warn("[1C] submit team update failed", error);
        return;
      }
      setRoundFormatConfig(nextCfg as FormatConfig);
      setSubmittedTeams(nextSubmitted);
    } finally {
      setSubmitting(false);
      setSubmitModal(false);
    }
  };

  // Finalize when every team has submitted. RPC is concurrency-safe (SELECT ...
  // FOR UPDATE on rounds); payout persistence stays client-side, identical to
  // the individual scorecard's finalize path.
  const tryFinalizeIfAllSubmitted = async () => {
    if (allSubmittedRpcInFlight) return;
    if (isRoundComplete) return;
    if (allTeamNumbers.length === 0) return;
    if (!allTeamNumbers.every((t) => submittedTeams.includes(t))) return;
    setAllSubmittedRpcInFlight(true);
    try {
      const { data, error } = await supabase.rpc("finalize_round_team_card", {
        p_round_id: Number(roundId),
      });
      if (error) {
        console.warn("[1C] finalize RPC error", error);
        return;
      }
      const status = (data ?? "") as string;
      if (status === "finalized" || status === "already_complete") {
        setIsRoundComplete(true);
        // G2: persist payouts + fund movements. Non-fatal + idempotent.
        void persistPayoutsAfterFinalize(Number(roundId));
      } else if (status === "not_yet") {
        // Another team's score may still be propagating; refreshSubmittedTeams
        // will re-trigger this effect when it lands.
        console.warn("[1C] all submitted but RPC said not_yet");
      }
    } finally {
      setAllSubmittedRpcInFlight(false);
    }
  };

  const ensureFormatLocked = async () => {
    if (roundFormatLockedAt !== null) return;
    // Format lock lives on the round's primary flight (Session 1).
    const flight = await getPrimaryFlightForRound(Number(roundId));
    if (!flight) return;
    const { data } = await supabase
      .from("flights")
      .update({ format_locked_at: new Date().toISOString() })
      .eq("id", flight.id)
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
  // Phase 1C: NET headline = net delta vs par, where net = gross − teamHandicap
  // (a single deduction off the team gross). Per-hole / grid stay GROSS.
  const teamNet = grossTotal - (teamHandicap ?? 0);
  const netDelta = teamNet - parScored;
  const deltaLabel = thru === 0 ? "—" : netDelta === 0 ? "E" : netDelta > 0 ? `+${netDelta}` : `−${-netDelta}`;

  // Submission state for THIS team.
  const myTeamSubmitted = teamNumber != null && submittedTeams.includes(teamNumber);
  // Alternate Shot is 2-person only — block submit (and warn) when this team
  // isn't exactly 2. (The FormatPicker also guards selection; this is the
  // belt-and-suspenders finalize-side check.)
  const altShotBadSize = roundFormat === "alternate_shot" && teamSize !== 2;
  // Every hole must have a team score before this team can submit.
  const allHolesScored = thru === 18;
  const canSubmit = allHolesScored && !altShotBadSize;

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
        {/* Phase 1C: NET team-card. The whole-team handicap is a single
            deduction off the team gross (the per-format weighting IS the
            allowance). Replaces the individual card's "Handicaps at N%" caption. */}
        <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#c2410c", letterSpacing: "0.02em", marginBottom: "8px" }}>
          Net — team handicap {teamHandicap ?? "—"}
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
          {/* Headline = NET delta vs par. */}
          <div style={{ fontSize: "0.65rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>Net</div>
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

      {/* Gross · HCP · Net caption — the headline above is the net delta. */}
      {thru > 0 && (
        <div
          data-testid="summary-net-caption"
          style={{
            textAlign: "center", marginTop: "-8px", marginBottom: "16px",
            fontSize: "0.72rem", fontWeight: 600, color: "#64748b",
          }}
        >
          Gross {grossTotal} · HCP {teamHandicap ?? "—"} · Net {teamNet}
        </div>
      )}

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

      {/* Alternate Shot is 2-person only — persistent warning when this team
          isn't exactly 2. The picker also blocks selection; this covers a team
          edited after the format was locked. */}
      {altShotBadSize && !isRoundComplete && (
        <div
          data-testid="altshot-team-size-warning"
          style={{
            marginTop: "16px", padding: "12px 14px", borderRadius: "10px",
            background: "#fef2f2", border: "1px solid #fca5a5",
            color: "#a32d2d", fontSize: "0.8rem", fontWeight: 600, textAlign: "center",
          }}
        >
          Alternate Shot needs exactly 2 players per team. Team {teamFilter} has {teamSize}. Fix the team before submitting.
        </div>
      )}

      {/* Phase 1C: Submit Final Scores — per-team commit gate (ported from the
          individual scorecard). Disabled until every hole is scored (and, for
          Alternate Shot, the team is exactly 2). Hides after this team submits. */}
      {teamNumber != null && !isRoundComplete && !myTeamSubmitted && (
        <div style={{ marginTop: "16px" }}>
          <button
            type="button"
            onClick={() => setSubmitModal(true)}
            disabled={!canSubmit || submitting}
            style={{
              width: "100%", padding: "18px", borderRadius: "12px",
              background: canSubmit && !submitting ? "#15803d" : "#cbd5e1",
              color: "white", border: "none", fontWeight: 900, fontSize: "1rem",
              cursor: canSubmit && !submitting ? "pointer" : "not-allowed",
              fontFamily: "sans-serif",
            }}
          >
            {submitting ? "Submitting…" : "Submit Final Scores"}
          </button>
          {!canSubmit && !altShotBadSize && (
            <p style={{ margin: "8px 0 0", textAlign: "center", fontSize: "0.72rem", color: "#94a3b8" }}>
              Available once this team has a score on every hole.
            </p>
          )}
        </div>
      )}

      {submitModal && teamNumber != null && (
        <DangerModal
          title={`Submit Team ${teamFilter}'s final scores?`}
          description="You won't be able to edit these scores after submitting."
          cannotBeUndone
          confirmLabel="Submit"
          onConfirm={() => void submitTeam(teamNumber)}
          onCancel={() => setSubmitModal(false)}
        />
      )}
    </div>
  );
}
