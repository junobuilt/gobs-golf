"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

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
        <div style={{
          background: "var(--white)",
          borderRadius: "var(--card-radius)",
          overflow: "hidden",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          border: "1px solid rgba(0,0,0,0.04)",
        }}>
          {filtered.map((player) => (
            <Link
              key={player.id}
              href={`/player/${player.id}`}
              className="player-row"
            >
              <div>
                <div className="player-name">{player.full_name}</div>
                <div className="player-meta">
                  {player.display_name || "—"}
                </div>
              </div>
              <div className="player-handicap">
                {player.handicap_index !== null ? (
                  <>
                    <strong>{player.handicap_index}</strong>
                    HCP
                  </>
                ) : (
                  <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                    No HCP
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
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