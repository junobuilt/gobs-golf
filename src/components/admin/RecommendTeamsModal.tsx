"use client";

// I6 — Team Recommendation Engine modal.
// Fetches played-with history, derives per-player CH (snapshot or computed),
// runs recommendTeams (pure), and previews the result before writing anything.
// Only Apply writes — Generate is always preview-only.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { computePairMatrix, fetchPlayedWithRows } from "@/lib/playedWith/compute";
import { recommendTeams, type RecommendResult, type PartitionMode } from "@/lib/teamRecommend";
import { buildNotes } from "@/lib/teamRecommend/notes";
import { computeCourseHandicap } from "@/lib/scoring/handicap";
import { DEFAULT_TEE_ID } from "@/lib/tees";
import SeasonToggle, { type SeasonFilter } from "@/components/season/SeasonToggle";
import DangerModal from "@/app/admin/components/DangerModal";
import type { Player } from "@/app/admin/page";
import type { Season } from "@/lib/seasons";

export type PlayerRpInfo = {
  courseHandicap: number | null;
  teeId: number | null;
};

interface Props {
  activeSeasonId: number | null;
  activeSeason: Season | null;
  roster: Player[];                             // checked-in players
  playerRpInfo: Record<number, PlayerRpInfo>;   // snapshot CH + per-round tee
  hasExistingTeams: boolean;                    // drives overwrite DangerModal
  roundId?: number | string | null;            // deterministic seed source
  onApply: (result: RecommendResult) => void;
  onClose: () => void;
}

type Tee = { id: number; slope_rating: number; course_rating: number; par: number };

const DEFAULT_TOL = 2.5;
const DEFAULT_SIZE = 4;

const C = {
  navy: "#0b2d50",
  green: "#276e34",
  gold: "#e8a800",
  goldText: "#1a1a1a",
  amber: "#92400e",
  amberBg: "#fffbeb",
  amberBorder: "#fcd34d",
  red: "#c0392b",
  border: "#e4e4e4",
  subtext: "#64748b",
  font: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
};

export default function RecommendTeamsModal({
  activeSeasonId,
  activeSeason,
  roster,
  playerRpInfo,
  hasExistingTeams,
  roundId,
  onApply,
  onClose,
}: Props) {
  const [partitionMode, setPartitionMode] = useState<"size" | "count">("size");
  const [partitionValue, setPartitionValue] = useState(DEFAULT_SIZE);
  const [toleranceCH, setToleranceCH] = useState(DEFAULT_TOL);
  const [seasonFilter, setSeasonFilter] = useState<SeasonFilter>("this_season");
  const [result, setResult] = useState<RecommendResult | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tees, setTees] = useState<Tee[]>([]);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [seedCounter, setSeedCounter] = useState(0);

  // Load tees once on open (needed for CH derivation).
  useEffect(() => {
    supabase
      .from("tees")
      .select("id, slope_rating, course_rating, par")
      .then(({ data }) => {
        if (data) setTees(data as Tee[]);
      });
  }, []);

  const teeById = useCallback(
    (id: number): Tee | undefined => tees.find((t) => t.id === id),
    [tees],
  );

  const nameOf = (player: Player): string =>
    player.display_name ?? player.full_name;

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const seasonId = seasonFilter === "this_season" ? activeSeasonId : null;
      const { rpRows } = await fetchPlayedWithRows(seasonId);
      const pairCounts = computePairMatrix(rpRows);

      const players: { id: number; courseHandicap: number }[] = [];
      const newExcluded: string[] = [];

      for (const player of roster) {
        const rpInfo = playerRpInfo[player.id];
        const snapshotCH = rpInfo?.courseHandicap ?? null;

        if (snapshotCH !== null) {
          players.push({ id: player.id, courseHandicap: snapshotCH });
          continue;
        }

        // Derive CH via canonical computeCourseHandicap.
        const teeId = rpInfo?.teeId ?? player.preferred_tee_id ?? DEFAULT_TEE_ID;
        const tee = teeById(teeId) ?? teeById(DEFAULT_TEE_ID);
        if (tee && player.handicap_index !== null) {
          const ch = computeCourseHandicap(
            player.handicap_index,
            tee.slope_rating,
            tee.course_rating,
            tee.par,
          );
          if (ch !== null) {
            players.push({ id: player.id, courseHandicap: ch });
            continue;
          }
        }

        // No resolvable handicap_index — exclude.
        newExcluded.push(nameOf(player));
      }

      setExcluded(newExcluded);

      if (players.length < 2) {
        setError("Not enough players with handicap data to generate teams.");
        return;
      }

      const partition: PartitionMode =
        partitionMode === "size"
          ? { mode: "size", value: partitionValue }
          : { mode: "count", value: partitionValue };

      // Deterministic seed: engine hashes roundId (else sorted player IDs) and
      // XORs the seedCounter nonce, so the same round + same re-roll count yields
      // the same teams, and re-roll produces a different-but-deterministic draft.
      const raw = recommendTeams({
        players,
        pairCounts,
        partition,
        toleranceCH,
        roundId: roundId ?? null,
        nonce: seedCounter,
      });

      // Sort teams ascending by roster size so preview team numbers == applied
      // team numbers (smaller teams are Team 1, Team 2, …). Stable sort
      // preserves engine order within equal-size groups.
      const sortedTeams = [...raw.teams].sort(
        (a, b) => a.playerIds.length - b.playerIds.length,
      );
      setResult({ ...raw, teams: sortedTeams });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [
    seasonFilter,
    activeSeasonId,
    roster,
    playerRpInfo,
    partitionMode,
    partitionValue,
    toleranceCH,
    teeById,
    seedCounter,
    roundId,
  ]);

  const handleReroll = () => {
    setSeedCounter((c) => c + 1);
  };
  // Re-generate whenever seed counter changes (except on mount).
  const [hasGenerated, setHasGenerated] = useState(false);
  useEffect(() => {
    if (hasGenerated) {
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedCounter]);

  const handleGenerate = () => {
    setHasGenerated(true);
    generate();
  };

  const handleApplyConfirm = () => {
    if (result) onApply(result);
    setDangerOpen(false);
  };

  const handleApply = () => {
    if (!result) return;
    if (hasExistingTeams) {
      setDangerOpen(true);
    } else {
      onApply(result);
    }
  };

  const playerById = (id: number) => roster.find((p) => p.id === id);

  return (
    <>
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 1100,
          background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "flex-end", justifyContent: "center",
          fontFamily: C.font,
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Recommend Teams"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div style={{
          background: "white",
          borderRadius: "20px 20px 0 0",
          width: "100%",
          maxWidth: "600px",
          maxHeight: "90dvh",
          overflowY: "auto",
          padding: "24px 20px 32px",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.2)",
        }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
            <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700, color: C.navy }}>
              Recommend Teams
            </h2>
            <button
              onClick={onClose}
              style={{
                background: "none", border: "none", fontSize: "1.4rem",
                color: C.subtext, cursor: "pointer", padding: "4px 8px", lineHeight: 1,
              }}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Controls */}
          <div style={{ marginBottom: "20px" }}>
            {/* Split by */}
            <div style={{ marginBottom: "14px" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: C.subtext, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
                Split by
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ display: "flex", borderRadius: "8px", border: `1.5px solid ${C.border}`, overflow: "hidden" }}>
                  {(["size", "count"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setPartitionMode(mode)}
                      style={{
                        padding: "7px 14px",
                        fontSize: "0.85rem", fontWeight: 600,
                        border: "none",
                        background: partitionMode === mode ? C.navy : "white",
                        color: partitionMode === mode ? "white" : "#374151",
                        cursor: "pointer",
                        fontFamily: C.font,
                      }}
                    >
                      {mode === "size" ? "Team size" : "# of teams"}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <button
                    type="button"
                    onClick={() => setPartitionValue((v) => Math.max(2, v - 1))}
                    style={stepperBtnStyle}
                  >−</button>
                  <span style={{ fontSize: "1rem", fontWeight: 700, color: C.navy, minWidth: "24px", textAlign: "center" }}>
                    {partitionValue}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPartitionValue((v) => Math.min(20, v + 1))}
                    style={stepperBtnStyle}
                  >+</button>
                </div>
              </div>
            </div>

            {/* Balance tolerance */}
            <div style={{ marginBottom: "14px" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: C.subtext, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
                Balance tolerance (CH pts)
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <button type="button" onClick={() => setToleranceCH((v) => Math.max(0.5, parseFloat((v - 0.5).toFixed(1))))} style={stepperBtnStyle}>−</button>
                <span style={{ fontSize: "1rem", fontWeight: 700, color: C.navy, minWidth: "30px", textAlign: "center" }}>
                  {toleranceCH.toFixed(1)}
                </span>
                <button type="button" onClick={() => setToleranceCH((v) => Math.min(20, parseFloat((v + 0.5).toFixed(1))))} style={stepperBtnStyle}>+</button>
              </div>
            </div>

            {/* Novelty scope */}
            <div>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: C.subtext, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
                Novelty scope
              </div>
              <SeasonToggle
                value={seasonFilter}
                onChange={setSeasonFilter}
                accent="navy"
                activeSeason={activeSeason}
              />
            </div>
          </div>

          {/* Generate / Re-roll */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading || tees.length === 0}
              style={{
                flex: result ? 0 : 1,
                padding: "11px 18px",
                borderRadius: "10px",
                background: C.navy, color: "white",
                fontWeight: 700, fontSize: "0.95rem",
                border: "none", cursor: loading ? "default" : "pointer",
                opacity: loading || tees.length === 0 ? 0.6 : 1,
                fontFamily: C.font,
              }}
            >
              {loading ? "Generating…" : result ? "Generate" : "Generate Teams"}
            </button>
            {result && (
              <button
                type="button"
                onClick={handleReroll}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: "11px 18px",
                  borderRadius: "10px",
                  background: "white", color: C.navy,
                  fontWeight: 600, fontSize: "0.95rem",
                  border: `1.5px solid ${C.navy}`, cursor: loading ? "default" : "pointer",
                  opacity: loading ? 0.6 : 1,
                  fontFamily: C.font,
                }}
              >
                Re-roll
              </button>
            )}
          </div>

          {error && (
            <div style={{
              padding: "12px 14px", borderRadius: "8px",
              background: "#fef2f2", border: "1px solid #fca5a5",
              color: "#991b1b", fontSize: "0.88rem", marginBottom: "16px",
            }}>
              {error}
            </div>
          )}

          {/* Excluded players */}
          {excluded.length > 0 && (
            <div style={{
              padding: "10px 14px", borderRadius: "8px",
              background: C.amberBg, border: `1px solid ${C.amberBorder}`,
              color: C.amber, fontSize: "0.84rem", marginBottom: "16px",
            }}>
              No handicap data for: {excluded.join(", ")} — assign manually after applying.
            </div>
          )}

          {/* Result preview */}
          {result && (
            <div>
              {/* Header stats */}
              <div style={{
                display: "flex", gap: "16px", alignItems: "center",
                marginBottom: "14px", padding: "10px 14px",
                background: "#f8fafc", borderRadius: "8px",
                border: `1px solid ${C.border}`,
              }}>
                <span style={{ fontSize: "0.9rem", fontWeight: 600, color: C.navy }}>
                  Spread {result.spread.toFixed(1)} pts
                </span>
                <span style={{ color: C.subtext, fontSize: "0.88rem" }}>·</span>
                <span style={{ fontSize: "0.9rem", fontWeight: 600, color: C.navy }}>
                  Repeat pairings: {result.repeats}
                </span>
              </div>

              {/* Infeasible band warning — Case C copy (§9) */}
              {!result.metBand && (
                <div style={{
                  padding: "10px 14px", borderRadius: "8px",
                  background: C.amberBg, border: `1px solid ${C.amberBorder}`,
                  color: C.amber, fontSize: "0.84rem", marginBottom: "12px",
                  lineHeight: 1.5,
                }}>
                  {buildNotes(result).map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              )}

              {/* Team cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
                {result.teams.map((team, i) => (
                  <div
                    key={i}
                    style={{
                      background: "white", borderRadius: "10px",
                      border: `0.5px solid ${C.border}`,
                      padding: "12px 14px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: 700, color: C.subtext, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Team {i + 1}
                      </span>
                      <span style={{ fontSize: "0.8rem", color: C.subtext }}>
                        avg CH {team.avgCH.toFixed(1)}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.92rem", color: "#1f2937", lineHeight: 1.6 }}>
                      {team.playerIds
                        .map((id) => {
                          const p = playerById(id);
                          return p ? nameOf(p) : `Player ${id}`;
                        })
                        .join(", ")}
                    </div>
                  </div>
                ))}
              </div>

              {/* Why these teams — Case A/B copy (§9). Case C lives in the
                  amber banner above, so only show this when in-band. */}
              {result.metBand && (
                <details style={{ marginBottom: "16px" }}>
                  <summary style={{ fontSize: "0.84rem", color: C.subtext, cursor: "pointer", marginBottom: "6px" }}>
                    Why these teams?
                  </summary>
                  <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: "0.82rem", color: C.subtext, lineHeight: 1.7 }}>
                    {buildNotes(result).map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </details>
              )}

              {/* Apply */}
              <button
                type="button"
                onClick={handleApply}
                style={{
                  width: "100%", padding: "13px 14px", borderRadius: "10px",
                  background: C.green, border: "none", color: "white",
                  fontSize: "0.95rem", fontWeight: 700,
                  cursor: "pointer", fontFamily: C.font,
                }}
              >
                Apply Teams →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Overwrite guard — zIndex 1200 so it clears the modal's own 1100 overlay */}
      {dangerOpen && (
        <DangerModal
          title="Replace current teams?"
          description="This will overwrite the players already assigned to teams. You can make tweaks on the next screen."
          cannotBeUndone={false}
          confirmLabel="Replace"
          onConfirm={handleApplyConfirm}
          onCancel={() => setDangerOpen(false)}
          zIndex={1200}
        />
      )}
    </>
  );
}

const stepperBtnStyle: React.CSSProperties = {
  width: "32px", height: "32px",
  borderRadius: "8px",
  border: "1.5px solid #e4e4e4",
  background: "white", color: "#374151",
  fontSize: "1.1rem", fontWeight: 600,
  display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer", lineHeight: 1,
};
