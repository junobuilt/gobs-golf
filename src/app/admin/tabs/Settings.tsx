"use client";

import { useState, useEffect, useMemo, useTransition } from "react";
import { supabase } from "@/lib/supabase";
import { LeagueSettings } from "../page";
import SeasonManagement from "../components/SeasonManagement";
import {
  mintBackupPin,
  listBackupPins,
  revokeBackupPin,
  type BackupPinHolder,
} from "../settings/backupActions";
import Toggle from "@/components/admin/Toggle";
import DangerModal from "../components/DangerModal";
import PlayerCombobox, { type ComboOption } from "@/components/playedWith/PlayerCombobox";
import { todayVancouver, addYearsISO, formatLeagueDate } from "@/lib/date";
import type { Player } from "../page";

interface Props {
  settings: LeagueSettings;
  onRefresh: () => void;
  /** Active roster — backs the Backup Admin Access player picker. */
  players: Player[];
}

const C = {
  navy: "#0c3057",
  green: "#2a7a3a",
  border: "rgba(0,0,0,0.08)",
};

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

// Field label for the Backup Admin form. Plain words, high contrast, sized for
// the 60-80 audience rather than the muted micro-caption used elsewhere.
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.85rem",
  fontWeight: 600,
  color: "#374151",
  marginBottom: "6px",
};

// Expiry copy is a plain calendar date — "August 29, 2027" — rendered in the
// league's timezone so it matches the day the admin picked, not the viewer's.
// The credential itself expires at the END of that day (see endOfDayVancouverISO).
// Shared with the server action's rejection copy via formatLeagueDate.
const formatExpiry = formatLeagueDate;

/** Default expiry offered in the form: about a month out. */
function defaultExpiryDate(): string {
  const today = todayVancouver();
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 30);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// Bound the list read. On a phone with poor reception at the course a hanging
// server action would otherwise leave the admin staring at "…" indefinitely on
// the one screen that answers "who can get into my app right now?". A bounded
// wait turns that into an answerable state.
const LIST_TIMEOUT_MS = 8000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

/** A holder row's display name. A credential minted before v2 has no name
 *  snapshot at all — that, and ONLY that, is what makes it "pre-upgrade".
 *  player_id being null is NOT the test: the FK is ON DELETE SET NULL, so a
 *  named holder whose player row is later removed keeps holder_name and must
 *  keep reading as themselves. */
function holderLabel(row: BackupPinHolder): string {
  return row.holderName ?? "Unnamed (pre-upgrade)";
}

// Backup Admin Access — assign expiring 4-digit PINs to named people, see
// exactly who currently holds one, and remove any of them individually.
//
// v2 replaces the v1 single-active-credential card (one PIN, 1/3/7-day preset,
// "Replace backup PIN"). Several people can hold a PIN at once, so the card
// leads with the LIST of current holders — the question the admin actually has
// is "who can get in right now?" — and the assign form sits underneath.
//
// Talks to server actions only; the credential table is never read or written
// from this client component, and no hash ever crosses the boundary.
function BackupAdminCard({ players }: { players: Player[] }) {
  const [holders, setHolders] = useState<BackupPinHolder[] | null>(null);
  // Distinguished from "no holders": see listBackupPins. Claiming nobody has
  // access when the read failed would be the more dangerous of the two lies.
  const [loadFailed, setLoadFailed] = useState(false);
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [pin, setPin] = useState("");
  const [expiresOn, setExpiresOn] = useState<string>(defaultExpiryDate);
  const [reveal, setReveal] = useState<
    { pin: string; holderName: string; expiresAt: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<BackupPinHolder | null>(null);
  const [pending, startTransition] = useTransition();

  const minDate = todayVancouver();
  const maxDate = addYearsISO(minDate, 1);

  // Full names, not the scorecard short name: this is a security list, and the
  // admin needs to be sure WHICH Wayne is holding a credential.
  const options: ComboOption[] = useMemo(
    () =>
      players
        .map((p) => ({ id: p.id, label: p.full_name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [players]
  );

  const refresh = () => {
    withTimeout(listBackupPins(), LIST_TIMEOUT_MS)
      .then((rows) => { setHolders(rows); setLoadFailed(false); })
      .catch(() => { setHolders([]); setLoadFailed(true); });
  };
  useEffect(refresh, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const onAssign = () => {
    setError(null);
    if (playerId === null) {
      setError("Choose who this PIN is for.");
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError("Enter a 4-digit PIN.");
      return;
    }
    if (!expiresOn) {
      setError("Choose an expiry date.");
      return;
    }
    const fd = new FormData();
    fd.set("pin", pin);
    fd.set("player_id", String(playerId));
    fd.set("expires_on", expiresOn);
    startTransition(async () => {
      const res = await mintBackupPin(null, fd);
      if (res?.ok) {
        setReveal({ pin: res.pin, holderName: res.holderName, expiresAt: res.expiresAt });
        setPin("");
        setPlayerId(null);
        setExpiresOn(defaultExpiryDate());
        setToast("PIN assigned.");
        refresh();
      } else {
        setError(res?.error ?? "Could not assign the PIN. Try again.");
      }
    });
  };

  const onRemoveConfirmed = (row: BackupPinHolder) => {
    setConfirmRemove(null);
    startTransition(async () => {
      await revokeBackupPin(row.id);
      setToast("PIN removed.");
      refresh();
    });
  };

  // One-time reveal — stays until the admin taps "Done", so it can be handed off.
  if (reveal) {
    return (
      <Card>
        <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#1f2937", marginBottom: "12px" }}>
          PIN assigned to {reveal.holderName}
        </div>
        <div style={{
          background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "10px",
          padding: "16px", textAlign: "center", marginBottom: "12px",
        }}>
          <div style={{ fontSize: "0.82rem", color: "#6b7280", marginBottom: "4px" }}>
            {reveal.holderName}
          </div>
          <div style={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "0.3em", color: "#166534" }}>
            {reveal.pin}
          </div>
          <div style={{ fontSize: "0.9rem", color: "#6b7280", marginTop: "8px" }}>
            Works through {formatExpiry(reveal.expiresAt)}
          </div>
        </div>
        <div style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "12px", lineHeight: 1.5 }}>
          Write this down now — it won&rsquo;t be shown again. It can&rsquo;t be looked up
          later, only removed and replaced. Hand it to {reveal.holderName}.
        </div>
        <button
          onClick={() => setReveal(null)}
          style={{
            width: "100%", padding: "14px", borderRadius: "8px", border: "none",
            background: C.green, color: "white", fontSize: "1rem", fontWeight: 600, cursor: "pointer",
          }}
        >
          Done — I&rsquo;ve saved it
        </button>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ paddingBottom: "12px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#1f2937" }}>Backup Admin Access</div>
        <div style={{ fontSize: "0.85rem", color: "#6b7280", marginTop: "2px" }}>
          People who can sign in as admin right now.
        </div>
      </div>

      {/* ── Assigned PINs ─────────────────────────────────────────────────── */}
      <div style={{ paddingTop: "8px" }}>
        {holders === null ? (
          <div style={{ padding: "14px 0", fontSize: "0.9rem", color: "#9ca3af" }}>…</div>
        ) : loadFailed ? (
          <div role="alert" style={{ padding: "14px 0", fontSize: "0.9rem", color: "#c0392b", lineHeight: 1.5 }}>
            Couldn&rsquo;t load who has access. Reload the page to try again.
          </div>
        ) : holders.length === 0 ? (
          <div style={{ padding: "14px 0", fontSize: "0.9rem", color: "#9ca3af" }}>
            No PINs assigned.
          </div>
        ) : (
          holders.map((row) => (
            <div
              key={row.id}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                gap: "12px", padding: "14px 0", borderBottom: `1px solid ${C.border}`,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#1f2937" }}>
                  {holderLabel(row)}
                </div>
                <div style={{ fontSize: "0.85rem", color: "#6b7280", marginTop: "2px" }}>
                  Expires {formatExpiry(row.expiresAt)}
                </div>
                {row.holderName === null && (
                  // No name was captured before v2, so the created date is the
                  // only handle the admin has on who this is.
                  <div style={{ fontSize: "0.8rem", color: "#9ca3af", marginTop: "2px" }}>
                    Created {formatExpiry(row.createdAt)}
                  </div>
                )}
              </div>
              <button
                onClick={() => setConfirmRemove(row)}
                disabled={pending}
                style={{
                  flexShrink: 0, padding: "12px 16px", borderRadius: "8px",
                  border: "1.5px solid #c0392b", background: "white", color: "#c0392b",
                  fontSize: "0.9rem", fontWeight: 600, cursor: pending ? "default" : "pointer",
                }}
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      {/* ── Assign a new PIN ──────────────────────────────────────────────── */}
      <div style={{ paddingTop: "20px" }}>
        <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "#1f2937", marginBottom: "10px" }}>
          Assign a new PIN
        </div>

        <label htmlFor="backup-pin-player" style={labelStyle}>Who is it for?</label>
        <div style={{ marginBottom: "14px" }}>
          <PlayerCombobox
            options={options}
            value={playerId}
            onChange={(id) => { setPlayerId(id); setError(null); }}
            placeholder="Search a player…"
            ariaLabel="Who is it for?"
          />
        </div>

        <label htmlFor="backup-pin-digits" style={labelStyle}>4-digit PIN</label>
        <input
          id="backup-pin-digits"
          type="tel"
          inputMode="numeric"
          maxLength={4}
          placeholder="4-digit PIN"
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 4)); setError(null); }}
          style={{
            width: "100%", padding: "14px", fontSize: "1.25rem", textAlign: "center",
            letterSpacing: "0.4em", border: `1.5px solid ${C.border}`, borderRadius: "10px",
            background: "white", outline: "none", marginBottom: "14px", color: "#1f2937",
          }}
        />

        <label htmlFor="backup-pin-expiry" style={labelStyle}>Works through</label>
        <input
          id="backup-pin-expiry"
          type="date"
          value={expiresOn}
          min={minDate}
          max={maxDate}
          onChange={(e) => { setExpiresOn(e.target.value); setError(null); }}
          style={{
            width: "100%", padding: "14px", fontSize: "1rem",
            border: `1.5px solid ${C.border}`, borderRadius: "10px",
            background: "white", outline: "none", marginBottom: "6px", color: "#1f2937",
          }}
        />
        <div style={{ fontSize: "0.8rem", color: "#9ca3af", marginBottom: "16px" }}>
          The PIN works all day on this date, then stops.
        </div>

        {error && (
          <div role="alert" style={{ color: "#c0392b", fontSize: "0.9rem", marginBottom: "12px" }}>
            {error}
          </div>
        )}

        <button
          onClick={onAssign}
          disabled={pending}
          style={{
            width: "100%", padding: "16px", borderRadius: "10px", border: "none",
            background: "#e8a800", color: "#1a1a1a", fontSize: "1.05rem", fontWeight: 700,
            cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "…" : "Assign PIN"}
        </button>

        {toast && (
          <div
            role="status"
            style={{
              marginTop: "12px", padding: "12px", borderRadius: "8px",
              background: "#f0fdf4", border: "1px solid #bbf7d0",
              color: "#166534", fontSize: "0.9rem", fontWeight: 600, textAlign: "center",
            }}
          >
            {toast}
          </div>
        )}
      </div>

      {confirmRemove && (
        <DangerModal
          title="Remove admin access?"
          description={`Remove admin access for ${holderLabel(confirmRemove)} (expires ${formatExpiry(confirmRemove.expiresAt)})?`}
          cannotBeUndone={false}
          confirmLabel="Remove access"
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => onRemoveConfirmed(confirmRemove)}
        />
      )}
    </Card>
  );
}

export default function Settings({ settings, onRefresh, players }: Props) {
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
      <BackupAdminCard players={players} />

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
