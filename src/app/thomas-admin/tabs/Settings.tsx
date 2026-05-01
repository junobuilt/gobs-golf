"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { LeagueSettings } from "../page";

interface Props {
  settings: LeagueSettings;
  onRefresh: () => void;
}

const C = {
  navy: "#0c3057",
  green: "#2a7a3a",
  border: "rgba(0,0,0,0.08)",
};

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <div
      onClick={onChange}
      style={{
        width: "40px", height: "22px", borderRadius: "11px",
        background: value ? C.green : "#d1d5db",
        position: "relative", cursor: "pointer", flexShrink: 0,
        transition: "background 0.2s",
      }}
    >
      <div style={{
        width: "18px", height: "18px", borderRadius: "50%", background: "white",
        position: "absolute", top: "2px",
        left: value ? "20px" : "2px",
        transition: "left 0.2s",
        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
      }} />
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: "0.72rem", fontWeight: 700, color: "#9ca3af",
      textTransform: "uppercase", letterSpacing: "0.06em",
      marginBottom: "12px", marginTop: "4px",
    }}>
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "white", borderRadius: "10px", border: `1px solid ${C.border}`,
      padding: "20px", marginBottom: "16px",
    }}>
      {children}
    </div>
  );
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "12px 0", borderBottom: `1px solid ${C.border}`,
    }}>
      <div>
        <div style={{ fontSize: "0.9rem", fontWeight: 500, color: "#1f2937" }}>{label}</div>
        {description && <div style={{ fontSize: "0.78rem", color: "#9ca3af", marginTop: "2px" }}>{description}</div>}
      </div>
      <div style={{ marginLeft: "16px", flexShrink: 0 }}>{children}</div>
    </div>
  );
}

export default function Settings({ settings, onRefresh }: Props) {
  const [buyIn, setBuyIn] = useState(settings["buy_in_amount"] ?? "10");
  const [savingBuyIn, setSavingBuyIn] = useState(false);
  const [buyInSaved, setBuyInSaved] = useState(false);

  const toggleSetting = async (key: string) => {
    const current = settings[key] === "true";
    await supabase.from("league_settings").upsert({ key, value: String(!current) }, { onConflict: "key" });
    onRefresh();
  };

  const saveBuyIn = async () => {
    const val = parseFloat(buyIn);
    if (isNaN(val) || val < 0) return;
    setSavingBuyIn(true);
    await supabase.from("league_settings").upsert({ key: "buy_in_amount", value: String(val) }, { onConflict: "key" });
    setSavingBuyIn(false);
    setBuyInSaved(true);
    setTimeout(() => setBuyInSaved(false), 2000);
    onRefresh();
  };

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto", padding: "24px 16px" }}>

      {/* Money */}
      <SectionHeader>Money</SectionHeader>
      <Card>
        <SettingRow label="Default buy-in" description="Applied to each player per round">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "0.9rem", color: "#6b7280" }}>$</span>
            <input
              type="number"
              min="0"
              step="1"
              value={buyIn}
              onChange={e => { setBuyIn(e.target.value); setBuyInSaved(false); }}
              style={{
                width: "72px", padding: "6px 10px",
                border: `1.5px solid ${C.border}`, borderRadius: "8px",
                fontSize: "0.9rem", fontFamily: "DM Sans, system-ui, sans-serif",
                outline: "none", textAlign: "center", color: "#1f2937",
              }}
            />
            <button
              onClick={saveBuyIn}
              disabled={savingBuyIn}
              style={{
                padding: "6px 14px", borderRadius: "8px", border: "none",
                background: buyInSaved ? "#dcfce7" : C.green,
                color: buyInSaved ? "#166534" : "white",
                fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
                fontFamily: "DM Sans, system-ui, sans-serif",
                transition: "background 0.2s",
              }}
            >
              {buyInSaved ? "Saved ✓" : savingBuyIn ? "…" : "Save"}
            </button>
          </div>
        </SettingRow>
      </Card>

      {/* Display */}
      <SectionHeader>Display</SectionHeader>
      <Card>
        <SettingRow label="Show Leaderboard" description="Visible on the public leaderboard page">
          <Toggle value={settings["show_leaderboard"] === "true"} onChange={() => toggleSetting("show_leaderboard")} />
        </SettingRow>
        <div style={{ borderBottom: "none" }}>
          <SettingRow label="Show Weekly Winners" description="Display weekly winner highlights">
            <Toggle value={settings["show_weekly_winners"] === "true"} onChange={() => toggleSetting("show_weekly_winners")} />
          </SettingRow>
        </div>
      </Card>

      {/* Scoring */}
      <SectionHeader>Scoring</SectionHeader>
      <Card>
        <div style={{ borderBottom: "none" }}>
          <SettingRow label="2-ball Scoring" description="Count best 2 balls per team per hole">
            <Toggle value={settings["two_ball_scoring"] === "true"} onChange={() => toggleSetting("two_ball_scoring")} />
          </SettingRow>
        </div>
      </Card>

      {/* Future placeholders */}
      <SectionHeader>Coming Soon</SectionHeader>
      <Card>
        <div style={{ color: "#9ca3af", fontSize: "0.85rem", lineHeight: 1.6 }}>
          <div style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}`, opacity: 0.6 }}>Handicap adjustment rules</div>
          <div style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}`, opacity: 0.6 }}>Season date range</div>
          <div style={{ padding: "8px 0", opacity: 0.6 }}>Payout structure</div>
        </div>
      </Card>
    </div>
  );
}
