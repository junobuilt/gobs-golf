"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchPlayerStats, type PlayerStats } from "@/lib/playerStats";

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
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: playerData } = await supabase
        .from("players")
        .select("id, full_name, display_name, handicap_index")
        .eq("id", playerId)
        .single();

      if (playerData) {
        setPlayer(playerData);

        // TD26 fix (2026-05-22): order by the joined rounds.played_on, not
        // round_players.round_id. After the historical import (H.5) round
        // IDs no longer correspond to chronological date — older imports
        // landed with higher IDs than pre-existing live rounds. Ordering
        // by played_on keeps the round history list in true date order.
        const { data: roundPlayers } = await supabase
          .from("round_players")
          .select(`
            id,
            round_id,
            course_handicap,
            tees ( color ),
            rounds!inner ( played_on, is_complete ),
            scores ( strokes )
          `)
          .eq("player_id", playerId)
          .eq("rounds.is_complete", true)
          .order("played_on", { referencedTable: "rounds", ascending: false });

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

        const s = await fetchPlayerStats(Number(playerId));
        setStats(s);
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

      {/* I3 — Season Stats accordion */}
      <AccordionSection
        title="Season Stats"
        open={statsOpen}
        onToggle={() => setStatsOpen((v) => !v)}
      >
        <SeasonStatsPanel stats={stats} />
      </AccordionSection>

      {/* I1 — Round History accordion */}
      <AccordionSection
        title={`Round History (${rounds.length})`}
        open={historyOpen}
        onToggle={() => setHistoryOpen((v) => !v)}
      >
        {rounds.length === 0 ? (
          <div className="empty-state" style={{ padding: "12px 0" }}>
            <p style={{ fontWeight: 600 }}>No rounds recorded yet</p>
            <p style={{ fontSize: "0.85rem" }}>
              Scores will appear here after the first round
            </p>
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
                      ` · Course Handicap: ${round.course_handicap}`}
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
      </AccordionSection>
    </div>
  );
}

function AccordionSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      marginBottom: "12px",
      background: "var(--white)",
      borderRadius: "var(--card-radius)",
      overflow: "hidden",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      border: "1px solid rgba(0,0,0,0.04)",
    }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          font: "inherit",
          textAlign: "left",
        }}
      >
        <span style={{
          fontFamily: "var(--font-display)",
          fontSize: "1.05rem",
          fontWeight: 700,
          color: "var(--green-900)",
        }}>
          {title}
        </span>
        <svg
          width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth={2}
          style={{
            color: "var(--text-muted)",
            transition: "transform 150ms ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div style={{
          padding: "0 16px 16px",
          borderTop: "1px solid rgba(0,0,0,0.04)",
          paddingTop: "12px",
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

function SeasonStatsPanel({ stats }: { stats: PlayerStats | null }) {
  if (!stats || stats.roundsPlayed === 0) {
    return (
      <div className="empty-state" style={{ padding: "12px 0" }}>
        <p style={{ fontWeight: 600 }}>No rounds yet</p>
      </div>
    );
  }

  const showComparison =
    stats.recent5AvgGross != null &&
    stats.avgGross != null &&
    stats.roundsPlayed > 1;

  let trendLabel: string | null = null;
  let trendDelta: string | null = null;
  if (showComparison) {
    const delta = (stats.recent5AvgGross as number) - (stats.avgGross as number);
    if (Math.abs(delta) < 0.1) {
      trendLabel = "trending steady";
    } else if (delta < 0) {
      trendLabel = "trending better";
      trendDelta = `↓ ${Math.abs(delta).toFixed(1)}`;
    } else {
      trendLabel = "trending worse";
      trendDelta = `↑ ${delta.toFixed(1)}`;
    }
  }

  const recentN = Math.min(5, stats.recent5.length);

  return (
    <div>
      {/* Base stats line */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: "6px",
        marginBottom: "12px",
      }}>
        <StatTile label="Rounds" value={stats.roundsPlayed} />
        <StatTile label="Avg Gross" value={stats.avgGross ?? "—"} />
        <StatTile label="Avg Net" value={stats.avgNet ?? "—"} />
        <StatTile label="Best" value={stats.best ?? "—"} />
        <StatTile label="Worst" value={stats.worst ?? "—"} />
      </div>

      {/* Comparison + trend */}
      {showComparison && (
        <div style={{
          fontSize: "0.85rem",
          color: "var(--text-secondary)",
          marginBottom: "8px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
        }}>
          <span>
            Last {recentN}: <strong>{stats.recent5AvgGross?.toFixed(1)}</strong>
          </span>
          <span>·</span>
          <span>
            all-time: <strong>{stats.avgGross?.toFixed(1)}</strong>
          </span>
          {trendDelta && (
            <>
              <span>·</span>
              <span style={{
                color: trendLabel === "trending better"
                  ? "var(--green-600)"
                  : "var(--text-secondary)",
                fontWeight: 600,
              }}>
                {trendDelta}
              </span>
            </>
          )}
          {trendLabel && (
            <>
              <span>·</span>
              <span style={{
                fontStyle: "italic",
                color: "var(--text-muted)",
              }}>
                {trendLabel}
              </span>
            </>
          )}
        </div>
      )}

      {/* Sparkline */}
      <Sparkline totals={stats.allTotals} />

      {/* Recent scores list */}
      {stats.recent5.length > 0 && (
        <div style={{
          fontSize: "0.85rem",
          color: "var(--text-secondary)",
          marginTop: "10px",
        }}>
          Recent: {stats.recent5.join(", ")}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{
      background: "var(--bg-warm, #f2f1ed)",
      border: "1px solid rgba(0,0,0,0.04)",
      borderRadius: "8px",
      padding: "8px 4px",
      textAlign: "center",
    }}>
      <div style={{
        fontSize: "1.05rem",
        fontWeight: 700,
        color: "var(--green-900)",
      }}>
        {value}
      </div>
      <div style={{
        fontSize: "0.65rem",
        color: "var(--text-muted)",
        marginTop: "2px",
      }}>
        {label}
      </div>
    </div>
  );
}

function Sparkline({ totals }: { totals: number[] }) {
  if (totals.length < 2) return null;
  const W = 320;
  const H = 50;
  const PAD = 4;
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  const range = max - min || 1;
  const xStep = (W - 2 * PAD) / (totals.length - 1);
  const pts = totals.map((t, i) => ({
    x: PAD + i * xStep,
    y: PAD + ((max - t) / range) * (H - 2 * PAD),
  }));
  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "50px", display: "block", marginTop: "4px" }}
      aria-hidden
    >
      <path d={d} fill="none" stroke="var(--green-700)" strokeWidth={1.5} />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2} fill="var(--green-700)" />
      ))}
    </svg>
  );
}
