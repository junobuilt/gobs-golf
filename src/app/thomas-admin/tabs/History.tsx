"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const C = {
  navy: "#0c3057",
  border: "rgba(0,0,0,0.08)",
  bg: "#f5f4f0",
};

type TeamMap = Record<number, string[]>;

type RoundEntry = {
  id: number;
  played_on: string;
  is_complete: boolean;
  teams: TeamMap;
  playerCount: number;
};

function formatDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

export default function History() {
  const [rounds, setRounds] = useState<RoundEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      const { data: rawRounds } = await supabase
        .from("rounds")
        .select("id, played_on, is_complete")
        .order("played_on", { ascending: false });

      if (!rawRounds) { setLoading(false); return; }

      const entries = await Promise.all(rawRounds.map(async (r: any) => {
        const { data: rps } = await supabase
          .from("round_players")
          .select("team_number, players(display_name, full_name)")
          .eq("round_id", r.id);

        const teams: TeamMap = {};
        let count = 0;
        rps?.forEach((rp: any) => {
          const tn = rp.team_number;
          if (!tn) return;
          if (!teams[tn]) teams[tn] = [];
          teams[tn].push(rp.players?.display_name || rp.players?.full_name || "?");
          count++;
        });

        return { id: r.id, played_on: r.played_on, is_complete: r.is_complete, teams, playerCount: count };
      }));

      setRounds(entries);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "0.88rem" }}>
        Loading history…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "24px 16px" }}>
      {rounds.length === 0 && (
        <div style={{ textAlign: "center", color: "#9ca3af", padding: "40px" }}>No rounds recorded yet.</div>
      )}

      {rounds.map(round => {
        const teamNums = Object.keys(round.teams).map(Number).sort((a, b) => a - b);
        const isExpanded = expanded === round.id;

        return (
          <div
            key={round.id}
            style={{
              background: "white", borderRadius: "10px", border: `1px solid ${C.border}`,
              marginBottom: "10px", overflow: "hidden",
            }}
          >
            <button
              onClick={() => setExpanded(isExpanded ? null : round.id)}
              style={{
                width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "14px 16px", background: "none", border: "none", cursor: "pointer",
                fontFamily: "DM Sans, system-ui, sans-serif", textAlign: "left",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ fontSize: "0.95rem", fontWeight: 600, color: "#1f2937" }}>
                  {formatDate(round.played_on)}
                </span>
                <span style={{
                  padding: "2px 10px", borderRadius: "999px", fontSize: "0.7rem", fontWeight: 700,
                  background: round.is_complete ? "#dcfce7" : "#fef3c7",
                  color: round.is_complete ? "#166534" : "#92400e",
                }}>
                  {round.is_complete ? "Complete" : "In progress"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <span style={{ fontSize: "0.78rem", color: "#9ca3af" }}>
                  {teamNums.length} teams · {round.playerCount} players
                </span>
                <span style={{ color: "#9ca3af", fontSize: "0.85rem", transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                  ▾
                </span>
              </div>
            </button>

            {isExpanded && (
              <div style={{ borderTop: `1px solid ${C.border}`, padding: "14px 16px", background: C.bg }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "10px" }}>
                  {teamNums.map(tn => (
                    <div key={tn} style={{
                      background: "white", borderRadius: "8px", border: `1px solid ${C.border}`, overflow: "hidden",
                    }}>
                      <div style={{
                        background: C.navy, padding: "6px 10px",
                        fontSize: "0.68rem", fontWeight: 700, color: "white",
                        textTransform: "uppercase", letterSpacing: "0.05em",
                      }}>
                        Team {tn}
                      </div>
                      <div style={{ padding: "8px 10px" }}>
                        {round.teams[tn].map((name, i) => (
                          <div key={i} style={{ fontSize: "0.82rem", color: "#374151", padding: "2px 0" }}>
                            {name}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
