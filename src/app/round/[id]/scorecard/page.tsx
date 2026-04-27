"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useParams, useRouter } from "next/navigation";

type HoleInfo = {
  hole_number: number;
  par: number;
  yardage: number;
  stroke_index: number;
};

type RoundPlayerInfo = {
  id: number;
  player_id: number;
  tee_id: number;
  team_number: number;
  course_handicap: number | null;
  player_name: string;
  display_name: string;
};

type ScoreMap = {
  [roundPlayerId: number]: {
    [hole: number]: number;
  };
};

type HolesByTee = {
  [teeId: number]: HoleInfo[];
};

export default function ScorecardPage() {
  const params = useParams();
  const router = useRouter();
  const roundId = params.id as string;

  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerInfo[]>([]);
  const [holesByTee, setHolesByTee] = useState<HolesByTee>({});
  const [scores, setScores] = useState<ScoreMap>({});
  const [currentHole, setCurrentHole] = useState(1);
  const [playedOn, setPlayedOn] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  useEffect(() => {
    async function load() {
      // Fetch round info
      const { data: round } = await supabase
        .from("rounds")
        .select("played_on")
        .eq("id", roundId)
        .single();

      if (round) setPlayedOn(round.played_on);

      // Fetch round players with names
      const { data: rp } = await supabase
        .from("round_players")
        .select(`
          id, player_id, tee_id, team_number, course_handicap,
          players ( full_name, display_name )
        `)
        .eq("round_id", roundId)
        .order("team_number")
        .order("id");

      if (rp) {
        const players: RoundPlayerInfo[] = rp.map((r: any) => ({
          id: r.id,
          player_id: r.player_id,
          tee_id: r.tee_id,
          team_number: r.team_number,
          course_handicap: r.course_handicap,
          player_name: r.players?.full_name || "Unknown",
          display_name: r.players?.display_name || r.players?.full_name || "?",
        }));
        setRoundPlayers(players);

        // Fetch holes for each unique tee
        const teeIds = [...new Set(players.map((p) => p.tee_id))];
        const holesMap: HolesByTee = {};
        for (const teeId of teeIds) {
          const { data: holes } = await supabase
            .from("holes")
            .select("hole_number, par, yardage, stroke_index")
            .eq("tee_id", teeId)
            .order("hole_number");
          if (holes) holesMap[teeId] = holes;
        }
        setHolesByTee(holesMap);

        // Fetch existing scores
        const rpIds = players.map((p) => p.id);
        const { data: existingScores } = await supabase
          .from("scores")
          .select("round_player_id, hole_number, strokes")
          .in("round_player_id", rpIds);

        if (existingScores) {
          const scoreMap: ScoreMap = {};
          existingScores.forEach((s: any) => {
            if (!scoreMap[s.round_player_id]) scoreMap[s.round_player_id] = {};
            scoreMap[s.round_player_id][s.hole_number] = s.strokes;
          });
          setScores(scoreMap);

          // Find first hole without all scores entered
          for (let h = 1; h <= 18; h++) {
            const allEntered = players.every(
              (p) => scoreMap[p.id]?.[h] !== undefined
            );
            if (!allEntered) {
              setCurrentHole(h);
              break;
            }
          }
        }
      }
      setLoading(false);
    }
    load();
  }, [roundId]);

  function getScore(roundPlayerId: number, hole: number): number | undefined {
    return scores[roundPlayerId]?.[hole];
  }

  function getHoleInfo(teeId: number, hole: number): HoleInfo | undefined {
    return holesByTee[teeId]?.find((h) => h.hole_number === hole);
  }

  function getStrokesReceived(courseHandicap: number | null, strokeIndex: number): number {
    if (courseHandicap === null) return 0;
    if (courseHandicap <= 0) return 0;
    let strokes = 0;
    let remaining = courseHandicap;
    // First pass: 1 stroke per hole with SI <= remaining
    if (remaining >= strokeIndex) strokes++;
    remaining -= 18;
    // Second pass for handicaps > 18
    if (remaining > 0 && remaining >= strokeIndex) strokes++;
    remaining -= 18;
    // Third pass for handicaps > 36
    if (remaining > 0 && remaining >= strokeIndex) strokes++;
    return strokes;
  }

  const setScore = useCallback(
    async (roundPlayerId: number, hole: number, strokes: number) => {
      if (strokes < 1 || strokes > 20) return;

      setScores((prev) => ({
        ...prev,
        [roundPlayerId]: {
          ...prev[roundPlayerId],
          [hole]: strokes,
        },
      }));

      // Upsert to database
      const { data: existing } = await supabase
        .from("scores")
        .select("id")
        .eq("round_player_id", roundPlayerId)
        .eq("hole_number", hole)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("scores")
          .update({ strokes })
          .eq("id", existing.id);
      } else {
        await supabase.from("scores").insert({
          round_player_id: roundPlayerId,
          hole_number: hole,
          strokes,
        });
      }
    },
    []
  );

  function adjustScore(roundPlayerId: number, hole: number, delta: number) {
    const current = getScore(roundPlayerId, hole);
    const holeInfo = getHoleInfo(
      roundPlayers.find((p) => p.id === roundPlayerId)!.tee_id,
      hole
    );
    const defaultScore = holeInfo ? holeInfo.par : 4;
    const newScore = (current ?? defaultScore) + delta;
    setScore(roundPlayerId, hole, newScore);
  }

  function getTotalScore(roundPlayerId: number): number {
    const playerScores = scores[roundPlayerId] || {};
    return Object.values(playerScores).reduce((sum, s) => sum + s, 0);
  }

  function getHolesCompleted(roundPlayerId: number): number {
    return Object.keys(scores[roundPlayerId] || {}).length;
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  function scoreBadge(strokes: number, par: number) {
    const diff = strokes - par;
    if (diff <= -2) return { label: `${diff}`, className: "badge-birdie" };
    if (diff === -1) return { label: "Birdie", className: "badge-birdie" };
    if (diff === 0) return { label: "Par", className: "badge-par" };
    if (diff === 1) return { label: "Bogey", className: "badge-bogey" };
    return { label: `+${diff}`, className: "badge-double" };
  }

  async function finishRound() {
    setSaving(true);
    await supabase
      .from("rounds")
      .update({ is_complete: true })
      .eq("id", roundId);
    router.push("/");
  }

  if (loading) {
    return (
      <div className="page-content">
        <div className="loading">
          <div className="loading-dot" />
          <div className="loading-dot" />
          <div className="loading-dot" />
        </div>
      </div>
    );
  }

  // Summary view
  if (showSummary) {
    return (
      <div className="page-content">
        <h2 className="page-title">Round Summary</h2>
        <p className="page-subtitle">{formatDate(playedOn)}</p>

        {roundPlayers.map((rp) => {
          const total = getTotalScore(rp.id);
          const holesPlayed = getHolesCompleted(rp.id);
          return (
            <div key={rp.id} className="card">
              <div className="flex-between">
                <div>
                  <div style={{ fontWeight: 700 }}>{rp.display_name}</div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                    {holesPlayed}/18 holes · CH: {rp.course_handicap ?? "N/A"}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--green-900)" }}>
                    {total || "—"}
                  </div>
                  {total > 0 && (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                      {total - 72 > 0 ? `+${total - 72}` : total - 72 === 0 ? "E" : total - 72}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
          <button
            onClick={() => setShowSummary(false)}
            className="btn btn-secondary"
            style={{ flex: 1 }}
          >
            Back to Scorecard
          </button>
          <button
            onClick={finishRound}
            disabled={saving}
            className="btn btn-primary"
            style={{ flex: 1, opacity: saving ? 0.6 : 1 }}
          >
            {saving ? "Saving..." : "Finish Round"}
          </button>
        </div>
      </div>
    );
  }

  // Hole-by-hole entry view
  const firstTeeId = roundPlayers[0]?.tee_id;
  const currentHoleInfo = firstTeeId ? getHoleInfo(firstTeeId, currentHole) : null;

  return (
    <div className="page-content">
      {/* Hole navigation */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "16px",
      }}>
        <button
          onClick={() => setCurrentHole((h) => Math.max(1, h - 1))}
          disabled={currentHole === 1}
          className="score-adjust-btn"
          style={{
            width: "44px",
            height: "44px",
            fontSize: "1.4rem",
            opacity: currentHole === 1 ? 0.3 : 1,
          }}
        >
          ‹
        </button>

        <div style={{ textAlign: "center" }}>
          <div style={{
            fontFamily: "var(--font-display)",
            fontSize: "1.6rem",
            color: "var(--green-900)",
          }}>
            Hole {currentHole}
          </div>
          <div style={{
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
            display: "flex",
            gap: "12px",
            justifyContent: "center",
          }}>
            <span>Par {currentHoleInfo?.par ?? "?"}</span>
            <span>{currentHoleInfo?.yardage ?? "?"} yds</span>
            <span>SI {currentHoleInfo?.stroke_index ?? "?"}</span>
          </div>
        </div>

        <button
          onClick={() => setCurrentHole((h) => Math.min(18, h + 1))}
          disabled={currentHole === 18}
          className="score-adjust-btn"
          style={{
            width: "44px",
            height: "44px",
            fontSize: "1.4rem",
            opacity: currentHole === 18 ? 0.3 : 1,
          }}
        >
          ›
        </button>
      </div>

      {/* Hole dots */}
      <div style={{
        display: "flex",
        justifyContent: "center",
        gap: "4px",
        marginBottom: "20px",
        flexWrap: "wrap",
      }}>
        {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => {
          const allEntered = roundPlayers.every(
            (p) => scores[p.id]?.[h] !== undefined
          );
          return (
            <button
              key={h}
              onClick={() => setCurrentHole(h)}
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                border: h === currentHole ? "2px solid var(--green-700)" : "1px solid var(--cream-dark)",
                background: allEntered
                  ? "var(--green-500)"
                  : h === currentHole
                  ? "var(--green-100)"
                  : "var(--white)",
                color: allEntered ? "var(--white)" : "var(--text-secondary)",
                fontSize: "0.7rem",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "var(--font-body)",
              }}
            >
              {h}
            </button>
          );
        })}
      </div>

      {/* Score entry for each player */}
      {roundPlayers.map((rp) => {
        const playerHoleInfo = getHoleInfo(rp.tee_id, currentHole);
        const par = playerHoleInfo?.par ?? 4;
        const si = playerHoleInfo?.stroke_index ?? 99;
        const strokesReceived = getStrokesReceived(rp.course_handicap, si);
        const currentScore = getScore(rp.id, currentHole);
        const badge = currentScore ? scoreBadge(currentScore, par) : null;

        return (
          <div key={rp.id} className="card" style={{ padding: "14px" }}>
            <div className="flex-between" style={{ marginBottom: "10px" }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: "1rem" }}>
                  {rp.display_name}
                </span>
                {strokesReceived > 0 && (
                  <span style={{
                    marginLeft: "8px",
                    fontSize: "0.75rem",
                    background: "var(--gold-light)",
                    color: "#92400e",
                    padding: "2px 8px",
                    borderRadius: "10px",
                    fontWeight: 600,
                  }}>
                    {"●".repeat(strokesReceived)} stroke{strokesReceived > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                Total: {getTotalScore(rp.id) || "—"}
              </div>
            </div>

            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "16px",
            }}>
              <button
                className="score-adjust-btn"
                onClick={() => adjustScore(rp.id, currentHole, -1)}
              >
                −
              </button>

              <div style={{ textAlign: "center" }}>
                <div
                  className="score-input-big"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: currentScore
                      ? "var(--white)"
                      : "var(--cream)",
                    borderColor: currentScore
                      ? "var(--green-700)"
                      : "var(--cream-dark)",
                  }}
                >
                  {currentScore ?? "—"}
                </div>
                {badge && (
                  <span
                    className={`badge ${badge.className}`}
                    style={{ marginTop: "6px", display: "inline-block" }}
                  >
                    {badge.label}
                  </span>
                )}
              </div>

              <button
                className="score-adjust-btn"
                onClick={() => adjustScore(rp.id, currentHole, 1)}
              >
                +
              </button>
            </div>
          </div>
        );
      })}

      {/* Navigation buttons */}
      <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
        {currentHole < 18 ? (
          <button
            onClick={() => setCurrentHole((h) => h + 1)}
            className="btn btn-primary btn-large"
          >
            Next Hole →
          </button>
        ) : (
          <button
            onClick={() => setShowSummary(true)}
            className="btn btn-gold btn-large"
          >
            View Summary
          </button>
        )}
      </div>

      {/* Quick summary link always visible */}
      {currentHole < 18 && (
        <button
          onClick={() => setShowSummary(true)}
          style={{
            display: "block",
            width: "100%",
            textAlign: "center",
            marginTop: "10px",
            padding: "10px",
            background: "none",
            border: "none",
            color: "var(--green-700)",
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "var(--font-body)",
          }}
        >
          View Summary &amp; Finish Round
        </button>
      )}
    </div>
  );
}