"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { fetchPlayerStats, type PlayerStats } from "@/lib/playerStats";

type Player = {
  id: number;
  full_name: string;
  display_name: string | null;
  handicap_index: number | null;
};

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [statsCache, setStatsCache] = useState<Record<number, PlayerStats>>({});
  const [statsLoadingId, setStatsLoadingId] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("players")
        .select("id, full_name, display_name, handicap_index")
        .eq("is_active", true)
        .order("full_name");
      setPlayers(data || []);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = players.filter((p) =>
    p.full_name.toLowerCase().includes(search.toLowerCase())
  );

  async function toggleExpanded(playerId: number) {
    if (expandedId === playerId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(playerId);
    if (statsCache[playerId]) return;

    setStatsLoadingId(playerId);
    const stats = await fetchPlayerStats(playerId);
    setStatsCache((prev) => ({ ...prev, [playerId]: stats }));
    setStatsLoadingId((current) => (current === playerId ? null : current));
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div className="page-content">
      <h2 className="page-title">Players</h2>

      <div className="search-wrapper">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className="search-bar"
          placeholder="Search players..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="loading">
          <div className="loading-dot" />
          <div className="loading-dot" />
          <div className="loading-dot" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <p>No players found</p>
          </div>
        </div>
      ) : (
        <>
          {/* Column header — right-aligned over the handicap-index numbers
              below. Uses the small-caps muted-gray pattern shared with other
              section labels in the app. */}
          <div style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "0 16px 8px",
            fontSize: "0.7rem",
            fontWeight: 700,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
          }}>
            Handicap Index
          </div>
          <div style={{
            background: "var(--white)",
            borderRadius: "var(--card-radius)",
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            border: "1px solid rgba(0,0,0,0.04)",
          }}>
            {filtered.map((player) => {
              const isExpanded = expandedId === player.id;
              const stats = statsCache[player.id];
              const isStatsLoading = statsLoadingId === player.id && !stats;

              return (
                <div key={player.id}>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(player.id)}
                    aria-expanded={isExpanded}
                    aria-controls={`player-panel-${player.id}`}
                    className="player-row"
                    style={{
                      width: "100%",
                      background: "transparent",
                      border: "none",
                      textAlign: "left",
                      cursor: "pointer",
                      font: "inherit",
                    }}
                  >
                    <div>
                      <div className="player-name">{player.full_name}</div>
                      <div className="player-meta">
                        {player.display_name || "—"}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div className="player-handicap">
                        {player.handicap_index !== null ? (
                          <strong>{player.handicap_index}</strong>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>—</span>
                        )}
                      </div>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        style={{
                          color: "var(--text-muted)",
                          transition: "transform 150ms ease",
                          transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                        }}
                        aria-hidden
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </button>

                  {isExpanded && (
                    <div
                      id={`player-panel-${player.id}`}
                      style={{
                        padding: "12px 16px 16px",
                        background: "#fafaf8",
                        borderTop: "1px solid rgba(0,0,0,0.04)",
                      }}
                    >
                      {isStatsLoading ? (
                        <div className="loading" style={{ padding: "12px 0" }}>
                          <div className="loading-dot" />
                          <div className="loading-dot" />
                          <div className="loading-dot" />
                        </div>
                      ) : stats ? (
                        <>
                          <div style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr 1fr",
                            gap: "8px",
                            marginBottom: "12px",
                          }}>
                            <StatTile label="Rounds" value={stats.roundsPlayed} />
                            <StatTile label="Avg Score" value={stats.avgGross ?? "—"} />
                            <StatTile label="Best" value={stats.best ?? "—"} />
                          </div>
                          {stats.lastRound && (
                            <div style={{
                              fontSize: "0.8rem",
                              color: "var(--text-muted)",
                              marginBottom: "12px",
                            }}>
                              Last round: {formatDate(stats.lastRound.playedOn)} · {stats.lastRound.totalStrokes}
                            </div>
                          )}
                          <Link
                            href={`/player/${player.id}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "0.85rem",
                              fontWeight: 600,
                              color: "var(--green-700)",
                              textDecoration: "none",
                            }}
                          >
                            View full profile →
                          </Link>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <p style={{
        textAlign: "center",
        fontSize: "0.8rem",
        color: "var(--text-muted)",
        marginTop: "16px",
      }}>
        {filtered.length} of {players.length} players
      </p>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{
      background: "var(--white)",
      border: "1px solid rgba(0,0,0,0.04)",
      borderRadius: "8px",
      padding: "10px 6px",
      textAlign: "center",
    }}>
      <div style={{
        fontSize: "1.2rem",
        fontWeight: 700,
        color: "var(--green-900)",
      }}>
        {value}
      </div>
      <div style={{
        fontSize: "0.7rem",
        color: "var(--text-muted)",
        marginTop: "2px",
      }}>
        {label}
      </div>
    </div>
  );
}
