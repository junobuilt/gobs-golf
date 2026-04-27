"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useParams } from "next/navigation";
import Link from "next/link";

type Player = {
  id: number;
  full_name: string;
  display_name: string | null;
  handicap_index: number | null;
};

type RoundResult = {
  round_id: number;
  played_on: string;
  tee_color: string;
  total_strokes: number;
  course_handicap: number | null;
};

export default function PlayerProfilePage() {
  const params = useParams();
  const playerId = params.id as string;

  const [player, setPlayer] = useState<Player | null>(null);
  const [rounds, setRounds] = useState<RoundResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // Fetch player info
      const { data: playerData } = await supabase
        .from("players")
        .select("id, full_name, display_name, handicap_index")
        .eq("id", playerId)
        .single();

      if (playerData) {
        setPlayer(playerData);

        // Fetch their rounds with scores
        const { data: roundPlayers } = await supabase
          .from("round_players")
          .select(`
            id,
            round_id,
            course_handicap,
            tees ( color ),
            rounds ( played_on ),
            scores ( strokes )
          `)
          .eq("player_id", playerId)
          .order("round_id", { ascending: false });

        if (roundPlayers) {
          const results: RoundResult[] = roundPlayers
            .filter((rp: any) => rp.scores && rp.scores.length > 0)
            .map((rp: any) => ({
              round_id: rp.round_id,
              played_on: rp.rounds?.played_on || "",
              tee_color: rp.tees?.color || "?",
              total_strokes: rp.scores.reduce(
                (sum: number, s: any) => sum + (s.strokes || 0),
                0
              ),
              course_handicap: rp.course_handicap,
            }));
          setRounds(results);
        }
      }
      setLoading(false);
    }
    load();
  }, [playerId]);

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

  if (!player) {
    return (
      <div className="page-content">
        <div className="card empty-state">
          <p>Player not found</p>
          <Link href="/players" className="btn btn-secondary mt-4">
            Back to Players
          </Link>
        </div>
      </div>
    );
  }

  const avgScore =
    rounds.length > 0
      ? Math.round(
          (rounds.reduce((sum, r) => sum + r.total_strokes, 0) / rounds.length) * 10
        ) / 10
      : null;
  const bestScore =
    rounds.length > 0 ? Math.min(...rounds.map((r) => r.total_strokes)) : null;

  function formatDate(dateStr: string) {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  function scoreLabel(strokes: number) {
    const diff = strokes - 72;
    if (diff === 0) return "E";
    return diff > 0 ? `+${diff}` : `${diff}`;
  }

  return (
    <div className="page-content">
      {/* Player header */}
      <div style={{ marginBottom: "20px" }}>
        <Link
          href="/players"
          style={{
            fontSize: "0.85rem",
            color: "var(--green-700)",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            marginBottom: "8px",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
          All Players
        </Link>
        <h2 className="page-title" style={{ marginBottom: "4px" }}>
          {player.full_name}
        </h2>
        {player.handicap_index !== null && (
          <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
            Handicap Index: <strong>{player.handicap_index}</strong>
          </p>
        )}
      </div>

      {/* Stats cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "20px" }}>
        <div className="card" style={{ textAlign: "center", padding: "14px 8px" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--green-700)" }}>
            {rounds.length}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Rounds</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "14px 8px" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--green-700)" }}>
            {avgScore ?? "—"}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Avg Score</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "14px 8px" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--green-700)" }}>
            {bestScore ?? "—"}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Best</div>
        </div>
      </div>

      {/* Round history */}
      <h3 style={{
        fontFamily: "var(--font-display)",
        fontSize: "1.1rem",
        color: "var(--green-900)",
        marginBottom: "10px",
      }}>
        Round History
      </h3>

      {rounds.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <p style={{ fontWeight: 600 }}>No rounds recorded yet</p>
            <p style={{ fontSize: "0.85rem" }}>
              Scores will appear here after the first round
            </p>
          </div>
        </div>
      ) : (
        <div style={{
          background: "var(--white)",
          borderRadius: "var(--card-radius)",
          overflow: "hidden",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          border: "1px solid rgba(0,0,0,0.04)",
        }}>
          {rounds.map((round) => (
            <Link
              key={round.round_id}
              href={`/round/${round.round_id}/scorecard`}
              className="player-row"
            >
              <div>
                <div className="player-name">{formatDate(round.played_on)}</div>
                <div className="player-meta">
                  {round.tee_color} tees
                  {round.course_handicap !== null &&
                    ` · CH: ${round.course_handicap}`}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{
                  fontSize: "1.3rem",
                  fontWeight: 700,
                  color: "var(--green-900)",
                }}>
                  {round.total_strokes}
                </div>
                <div style={{
                  fontSize: "0.8rem",
                  color: round.total_strokes <= 72
                    ? "var(--green-600)"
                    : "var(--text-muted)",
                }}>
                  {scoreLabel(round.total_strokes)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}