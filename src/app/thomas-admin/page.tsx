"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import RoundSetup from "./tabs/RoundSetup";
import Players from "./tabs/Players";
import PlayedWith from "./tabs/PlayedWith";
import History from "./tabs/History";
import Settings from "./tabs/Settings";

export type Player = {
  id: number;
  full_name: string;
  display_name: string | null;
  handicap_index: number | null;
  is_active: boolean;
};

export type MatrixRow = {
  player_a: string;
  player_b: string;
  times_played_together: number;
};

export type LeagueSettings = Record<string, string>;

const TABS = ["Round Setup", "Players", "Played-with", "History", "Settings"] as const;
type Tab = typeof TABS[number];

const C = {
  navy: "#0c3057",
  midNavy: "#0f4a7a",
  green: "#2a7a3a",
  bg: "#f5f4f0",
  border: "rgba(0,0,0,0.08)",
};

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>("Round Setup");
  const [players, setPlayers] = useState<Player[]>([]);
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [settings, setSettings] = useState<LeagueSettings>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [{ data: p }, { data: m }, { data: s }] = await Promise.all([
        supabase.from("players").select("*").order("full_name"),
        supabase.from("played_with_matrix").select("*"),
        supabase.from("league_settings").select("key, value"),
      ]);
      if (p) setPlayers(p);
      if (m) setMatrix(m);
      if (s) {
        const map: LeagueSettings = {};
        s.forEach((row: { key: string; value: string }) => { map[row.key] = row.value; });
        setSettings(map);
      }
      setLoading(false);
    }
    load();
  }, []);

  const refreshPlayers = async () => {
    const { data } = await supabase.from("players").select("*").order("full_name");
    if (data) setPlayers(data);
  };

  const refreshSettings = async () => {
    const { data } = await supabase.from("league_settings").select("key, value");
    if (data) {
      const map: LeagueSettings = {};
      data.forEach((row: { key: string; value: string }) => { map[row.key] = row.value; });
      setSettings(map);
    }
  };

  if (loading) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: C.navy, fontFamily: "DM Sans, system-ui, sans-serif", fontSize: "0.9rem", opacity: 0.6 }}>
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "DM Sans, system-ui, sans-serif", paddingBottom: "80px" }}>
      {/* Tab nav */}
      <div style={{
        background: "white",
        borderBottom: `1px solid ${C.border}`,
        overflowX: "auto",
        WebkitOverflowScrolling: "touch" as any,
        scrollbarWidth: "none" as any,
      }}>
        <div style={{ display: "flex", minWidth: "max-content", padding: "0 16px" }}>
          {TABS.map(tab => {
            const active = tab === activeTab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "14px 18px",
                  border: "none",
                  borderBottom: active ? `2.5px solid ${C.navy}` : "2.5px solid transparent",
                  background: "none",
                  color: active ? C.navy : "#6b7280",
                  fontSize: "0.88rem",
                  fontWeight: active ? 700 : 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  fontFamily: "DM Sans, system-ui, sans-serif",
                  transition: "color 0.15s",
                  marginBottom: "-1px",
                }}
              >
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "Round Setup" && (
          <RoundSetup
            allPlayers={players.filter(p => p.is_active)}
            matrix={matrix}
            settings={settings}
            onSettingsChange={refreshSettings}
          />
        )}
        {activeTab === "Players" && (
          <Players players={players} onRefresh={refreshPlayers} />
        )}
        {activeTab === "Played-with" && (
          <PlayedWith players={players.filter(p => p.is_active)} matrix={matrix} />
        )}
        {activeTab === "History" && (
          <History />
        )}
        {activeTab === "Settings" && (
          <Settings settings={settings} onRefresh={refreshSettings} />
        )}
      </div>
    </div>
  );
}
