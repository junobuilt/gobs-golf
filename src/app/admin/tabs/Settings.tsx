"use client";

import { useState, useEffect, useTransition } from "react";
import { supabase } from "@/lib/supabase";
import { LeagueSettings } from "../page";
import SeasonManagement from "../components/SeasonManagement";
import {
  mintBackupPin,
  disableBackupPin,
  getBackupPinStatus,
  type BackupPinStatus,
} from "../settings/backupActions";

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

type ToggleKey = "show_leaderboard" | "show_weekly_winners";

const DAY_PRESETS = [1, 3, 7] as const;

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Backup Admin Access — mint an expiring 4-digit substitute PIN, see status,
// reveal once for handoff, disable immediately. Talks to server actions only
// (the credential table is never read/written from this client component).
function BackupAdminCard() {
  const [status, setStatus] = useState<BackupPinStatus | null>(null);
  const [pin, setPin] = useState("");
  const [days, setDays] = useState<number>(3);
  const [reveal, setReveal] = useState<{ pin: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = () => {
    getBackupPinStatus().then(setStatus).catch(() => setStatus({ active: false }));
  };
  useEffect(refresh, []);

  const onEnable = () => {
    setError(null);
    if (!/^\d{4}$/.test(pin)) {
      setError("Enter a 4-digit PIN.");
      return;
    }
    const fd = new FormData();
    fd.set("pin", pin);
    fd.set("days", String(days));
    startTransition(async () => {
      const res = await mintBackupPin(null, fd);
      if (res?.ok) {
        setReveal({ pin: res.pin, expiresAt: res.expiresAt });
        setPin("");
        setDays(3);
        refresh();
      } else {
        setError(res?.error ?? "Could not enable. Try again.");
      }
    });
  };

  const onDisable = () => {
    startTransition(async () => {
      const s = await disableBackupPin();
      setStatus(s);
      setReveal(null);
    });
  };

  const navyBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "12px 0",
    borderRadius: "8px",
    border: `1.5px solid ${active ? C.navy : C.border}`,
    background: active ? C.navy : "white",
    color: active ? "white" : "#374151",
    fontSize: "0.95rem",
    fontWeight: 600,
    cursor: "pointer",
  });

  // One-time reveal — stays until the admin taps "Done", so it can be handed off.
  if (reveal) {
    return (
      <Card>
        <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "#1f2937", marginBottom: "12px" }}>
          Backup PIN enabled
        </div>
        <div style={{
          background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "10px",
          padding: "16px", textAlign: "center", marginBottom: "12px",
        }}>
          <div style={{ fontSize: "0.78rem", color: "#6b7280", marginBottom: "4px" }}>Backup PIN</div>
          <div style={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "0.3em", color: "#166534" }}>
            {reveal.pin}
          </div>
          <div style={{ fontSize: "0.82rem", color: "#6b7280", marginTop: "8px" }}>
            Active until {formatExpiry(reveal.expiresAt)}
          </div>
        </div>
        <div style={{ fontSize: "0.8rem", color: "#9ca3af", marginBottom: "12px", lineHeight: 1.5 }}>
          Write this down now — it won’t be shown again. Hand it to the substitute admin.
        </div>
        <button
          onClick={() => setReveal(null)}
          style={{
            width: "100%", padding: "12px", borderRadius: "8px", border: "none",
            background: C.green, color: "white", fontSize: "0.95rem", fontWeight: 600, cursor: "pointer",
          }}
        >
          Done — I’ve saved it
        </button>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        paddingBottom: "12px", borderBottom: `1px solid ${C.border}`,
      }}>
        <div>
          <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "#1f2937" }}>Backup Admin Access</div>
          <div style={{ fontSize: "0.82rem", color: status?.active ? "#166534" : "#9ca3af", marginTop: "2px" }}>
            {status === null
              ? "…"
              : status.active && status.expiresAt
                ? `Active until ${formatExpiry(status.expiresAt)}`
                : "Inactive"}
          </div>
        </div>
        {status?.active && (
          <button
            onClick={onDisable}
            disabled={pending}
            style={{
              marginLeft: "16px", flexShrink: 0, padding: "8px 14px", borderRadius: "8px",
              border: "1.5px solid #c0392b", background: "white", color: "#c0392b",
              fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
            }}
          >
            Disable now
          </button>
        )}
      </div>

      <div style={{ paddingTop: "16px" }}>
        <div style={{ fontSize: "0.82rem", color: "#6b7280", marginBottom: "8px" }}>
          Create a temporary 4-digit PIN for a substitute admin.
        </div>
        <input
          type="tel"
          inputMode="numeric"
          maxLength={4}
          placeholder="4-digit PIN"
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 4)); setError(null); }}
          style={{
            width: "100%", padding: "14px", fontSize: "1.25rem", textAlign: "center",
            letterSpacing: "0.4em", border: `1.5px solid ${C.border}`, borderRadius: "10px",
            background: "white", outline: "none", marginBottom: "12px", color: "#1f2937",
          }}
        />
        <div style={{ fontSize: "0.78rem", color: "#6b7280", marginBottom: "6px" }}>Duration</div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          {DAY_PRESETS.map((d) => (
            <button key={d} onClick={() => setDays(d)} style={navyBtn(days === d)}>
              {d} {d === 1 ? "day" : "days"}
            </button>
          ))}
        </div>
        {error && (
          <div style={{ color: "var(--red-500, #c0392b)", fontSize: "0.85rem", marginBottom: "12px" }}>{error}</div>
        )}
        <button
          onClick={onEnable}
          disabled={pending}
          style={{
            width: "100%", padding: "14px", borderRadius: "10px", border: "none",
            background: "#e8a800", color: "#1a1a1a", fontSize: "1rem", fontWeight: 700,
            cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "…" : status?.active ? "Replace backup PIN" : "Enable"}
        </button>
      </div>
    </Card>
  );
}

export default function Settings({ settings, onRefresh }: Props) {
  const [buyIn, setBuyIn] = useState(settings["buy_in_amount"] ?? "10");
  const [savingBuyIn, setSavingBuyIn] = useState(false);
  const [buyInSaved, setBuyInSaved] = useState(false);

  // Optimistic local state — updates immediately on click, then syncs after DB round-trip
  const [localToggles, setLocalToggles] = useState<Record<ToggleKey, boolean>>({
    show_leaderboard: settings["show_leaderboard"] === "true",
    show_weekly_winners: settings["show_weekly_winners"] === "true",
  });

  useEffect(() => {
    setLocalToggles({
      show_leaderboard: settings["show_leaderboard"] === "true",
      show_weekly_winners: settings["show_weekly_winners"] === "true",
    });
  }, [settings]);

  const toggleSetting = async (key: ToggleKey) => {
    const newValue = !localToggles[key];
    setLocalToggles(prev => ({ ...prev, [key]: newValue }));
    // Use update (not upsert) to avoid creating duplicate rows if there's no unique constraint
    const { data } = await supabase
      .from("league_settings")
      .update({ value: String(newValue) })
      .eq("key", key)
      .select();
    if (!data || data.length === 0) {
      await supabase.from("league_settings").insert({ key, value: String(newValue) });
    }
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

      {/* Season management (H3.2 current season + End Season, H3.3 past + Reopen) */}
      <SeasonManagement />

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
                fontSize: "0.9rem", fontFamily: "system-ui, sans-serif",
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
                fontFamily: "system-ui, sans-serif",
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
        <SettingRow label="Show Season Stats" description="Visible on the season stats page (/season). Live leaderboard always visible.">
          <Toggle value={localToggles.show_leaderboard} onChange={() => toggleSetting("show_leaderboard")} />
        </SettingRow>
        <div style={{ borderBottom: "none" }}>
          <SettingRow label="Show Weekly Winners" description="Display weekly winner highlights">
            <Toggle value={localToggles.show_weekly_winners} onChange={() => toggleSetting("show_weekly_winners")} />
          </SettingRow>
        </div>
      </Card>

      {/* Security */}
      <SectionHeader>Security</SectionHeader>
      <BackupAdminCard />

      {/* Future placeholders */}
      <SectionHeader>Coming Soon</SectionHeader>
      <Card>
        <div style={{ color: "#9ca3af", fontSize: "0.85rem", lineHeight: 1.6 }}>
          <div style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}`, opacity: 0.6 }}>Handicap adjustment rules</div>
          <div style={{ padding: "8px 0", opacity: 0.6 }}>Payout structure</div>
        </div>
      </Card>
    </div>
  );
}
