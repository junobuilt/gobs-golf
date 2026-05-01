"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Player } from "../page";
import DangerModal from "../components/DangerModal";

interface Props {
  players: Player[];
  onRefresh: () => void;
}

const C = {
  navy: "#0c3057",
  green: "#2a7a3a",
  red: "#a32d2d",
  border: "rgba(0,0,0,0.08)",
  bg: "#f5f4f0",
};

type DeactivateTarget = { id: number; name: string };
type AddingState = { full_name: string; display_name: string; handicap_index: string };

export default function Players({ players, onRefresh }: Props) {
  const [search, setSearch] = useState("");
  const [editingHC, setEditingHC] = useState<Record<number, string>>({});
  const [savingHC, setSavingHC] = useState<number | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<DeactivateTarget | null>(null);
  const [adding, setAdding] = useState(false);
  const [newPlayer, setNewPlayer] = useState<AddingState>({ full_name: "", display_name: "", handicap_index: "" });
  const [savingNew, setSavingNew] = useState(false);

  const filtered = players.filter(p =>
    p.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (p.display_name || "").toLowerCase().includes(search.toLowerCase())
  );
  const active = filtered.filter(p => p.is_active);
  const inactive = filtered.filter(p => !p.is_active);
  const displayed = [...active, ...inactive];

  const startEditHC = (p: Player) => {
    setEditingHC(prev => ({ ...prev, [p.id]: p.handicap_index != null ? String(p.handicap_index) : "" }));
  };

  const cancelEditHC = (id: number) => {
    setEditingHC(prev => { const next = { ...prev }; delete next[id]; return next; });
  };

  const saveHC = async (p: Player) => {
    setSavingHC(p.id);
    const raw = editingHC[p.id].trim();
    const value = raw === "" ? null : parseFloat(raw);
    await supabase.from("players").update({ handicap_index: value }).eq("id", p.id);
    cancelEditHC(p.id);
    setSavingHC(null);
    onRefresh();
  };

  const doDeactivate = async () => {
    if (!deactivateTarget) return;
    await supabase.from("players").update({ is_active: false }).eq("id", deactivateTarget.id);
    setDeactivateTarget(null);
    onRefresh();
  };

  const reactivate = async (id: number) => {
    await supabase.from("players").update({ is_active: true }).eq("id", id);
    onRefresh();
  };

  const saveNewPlayer = async () => {
    if (!newPlayer.full_name.trim()) return;
    setSavingNew(true);
    const hc = newPlayer.handicap_index.trim();
    await supabase.from("players").insert({
      full_name: newPlayer.full_name.trim(),
      display_name: newPlayer.display_name.trim() || null,
      handicap_index: hc === "" ? null : parseFloat(hc),
      is_active: true,
    });
    setAdding(false);
    setNewPlayer({ full_name: "", display_name: "", handicap_index: "" });
    setSavingNew(false);
    onRefresh();
  };

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "24px 16px" }}>
      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ position: "relative", flex: "1 1 200px", maxWidth: "300px" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"
            style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)" }}>
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            placeholder="Search players…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: "100%", padding: "8px 10px 8px 30px",
              border: `1px solid ${C.border}`, borderRadius: "8px",
              fontSize: "0.82rem", fontFamily: "DM Sans, system-ui, sans-serif",
              outline: "none", background: "white", color: "#1f2937",
            }}
          />
        </div>
        <button
          onClick={() => setAdding(true)}
          style={{
            padding: "9px 18px", borderRadius: "8px", border: "none",
            background: C.green, color: "white",
            fontSize: "0.85rem", fontWeight: 600, cursor: "pointer",
            fontFamily: "DM Sans, system-ui, sans-serif",
          }}
        >
          + Add player
        </button>
      </div>

      {/* Add player form */}
      {adding && (
        <div style={{
          background: "white", borderRadius: "10px", border: `1px solid ${C.border}`,
          padding: "20px", marginBottom: "20px",
        }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "14px" }}>
            New Player
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px", gap: "10px", flexWrap: "wrap" }}>
            <input
              placeholder="Full name *"
              value={newPlayer.full_name}
              onChange={e => setNewPlayer(p => ({ ...p, full_name: e.target.value }))}
              style={inputStyle}
            />
            <input
              placeholder="Display name"
              value={newPlayer.display_name}
              onChange={e => setNewPlayer(p => ({ ...p, display_name: e.target.value }))}
              style={inputStyle}
            />
            <input
              placeholder="Handicap"
              type="number"
              step="0.1"
              value={newPlayer.handicap_index}
              onChange={e => setNewPlayer(p => ({ ...p, handicap_index: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
            <button onClick={saveNewPlayer} disabled={savingNew || !newPlayer.full_name.trim()} style={{
              padding: "8px 20px", borderRadius: "8px", border: "none",
              background: C.green, color: "white",
              fontSize: "0.85rem", fontWeight: 600, cursor: "pointer",
              opacity: savingNew || !newPlayer.full_name.trim() ? 0.5 : 1,
              fontFamily: "DM Sans, system-ui, sans-serif",
            }}>
              {savingNew ? "Saving…" : "Save"}
            </button>
            <button onClick={() => { setAdding(false); setNewPlayer({ full_name: "", display_name: "", handicap_index: "" }); }} style={{
              padding: "8px 16px", borderRadius: "8px",
              border: `1.5px solid ${C.border}`, background: "white",
              fontSize: "0.85rem", fontWeight: 600, color: "#6b7280", cursor: "pointer",
              fontFamily: "DM Sans, system-ui, sans-serif",
            }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ background: "white", borderRadius: "10px", border: `1px solid ${C.border}`, overflow: "hidden" }}>
        {/* Header */}
        <div style={{
          display: "grid", gridTemplateColumns: "2fr 1.5fr 120px 100px 160px",
          padding: "10px 16px", borderBottom: `1px solid ${C.border}`,
          fontSize: "0.7rem", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em",
        }}>
          <span>Full Name</span>
          <span>Display Name</span>
          <span>Handicap</span>
          <span>Status</span>
          <span>Actions</span>
        </div>

        {displayed.length === 0 && (
          <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "0.88rem" }}>
            No players found
          </div>
        )}

        {displayed.map((p, i) => {
          const isEditing = p.id in editingHC;
          const isLast = i === displayed.length - 1;

          return (
            <div
              key={p.id}
              style={{
                display: "grid", gridTemplateColumns: "2fr 1.5fr 120px 100px 160px",
                padding: "12px 16px", alignItems: "center",
                borderBottom: isLast ? "none" : `1px solid ${C.border}`,
                opacity: p.is_active ? 1 : 0.55,
              }}
            >
              <span style={{ fontSize: "0.9rem", fontWeight: 500, color: "#1f2937" }}>{p.full_name}</span>
              <span style={{ fontSize: "0.85rem", color: "#6b7280" }}>{p.display_name || <em style={{ color: "#d1d5db" }}>—</em>}</span>

              {/* Handicap cell */}
              <div>
                {isEditing ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <input
                      type="number"
                      step="0.1"
                      autoFocus
                      value={editingHC[p.id]}
                      onChange={e => setEditingHC(prev => ({ ...prev, [p.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === "Enter") saveHC(p); if (e.key === "Escape") cancelEditHC(p.id); }}
                      style={{
                        width: "64px", padding: "4px 6px",
                        border: `1.5px solid ${C.navy}`, borderRadius: "6px",
                        fontSize: "0.85rem", fontFamily: "DM Sans, system-ui, sans-serif",
                        outline: "none", color: "#1f2937",
                      }}
                    />
                    <button onClick={() => saveHC(p)} disabled={savingHC === p.id} style={smallBtnStyle(C.green)}>✓</button>
                    <button onClick={() => cancelEditHC(p.id)} style={smallBtnStyle("#6b7280")}>✕</button>
                  </div>
                ) : p.handicap_index != null ? (
                  <span style={{ fontSize: "0.88rem", color: "#1f2937", fontWeight: 500 }}>{p.handicap_index}</span>
                ) : (
                  <span style={{
                    display: "inline-block", padding: "2px 8px", borderRadius: "999px",
                    background: "#fef3c7", color: "#92400e",
                    fontSize: "0.72rem", fontWeight: 700,
                  }}>No HC</span>
                )}
              </div>

              {/* Status */}
              <div>
                <span style={{
                  display: "inline-block", padding: "3px 10px", borderRadius: "999px",
                  background: p.is_active ? "#dcfce7" : "#f3f4f6",
                  color: p.is_active ? "#166534" : "#6b7280",
                  fontSize: "0.72rem", fontWeight: 700,
                }}>
                  {p.is_active ? "Active" : "Inactive"}
                </span>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  onClick={() => isEditing ? cancelEditHC(p.id) : startEditHC(p)}
                  style={actionBtnStyle(C.navy)}
                >
                  {p.handicap_index == null && !isEditing ? "Add HC" : isEditing ? "Cancel" : "Edit HC"}
                </button>
                {p.is_active ? (
                  <button
                    onClick={() => setDeactivateTarget({ id: p.id, name: p.full_name })}
                    style={actionBtnStyle(C.red)}
                  >
                    Deactivate
                  </button>
                ) : (
                  <button onClick={() => reactivate(p.id)} style={actionBtnStyle(C.green)}>
                    Reactivate
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: "12px", fontSize: "0.78rem", color: "#9ca3af", textAlign: "right" }}>
        {active.length} active · {inactive.length} inactive
      </div>

      {deactivateTarget && (
        <DangerModal
          title={`Deactivate ${deactivateTarget.name}?`}
          description={`${deactivateTarget.name} will be removed from the active player roster and won't appear in future round setup. Their history is preserved.`}
          confirmLabel="Deactivate"
          onConfirm={doDeactivate}
          onCancel={() => setDeactivateTarget(null)}
        />
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 10px", border: "1px solid rgba(0,0,0,0.1)", borderRadius: "8px",
  fontSize: "0.85rem", fontFamily: "DM Sans, system-ui, sans-serif",
  outline: "none", width: "100%", color: "#1f2937",
};

function smallBtnStyle(color: string): React.CSSProperties {
  return {
    padding: "3px 7px", borderRadius: "5px", border: "none",
    background: color, color: "white",
    fontSize: "0.75rem", fontWeight: 700, cursor: "pointer",
    fontFamily: "DM Sans, system-ui, sans-serif",
  };
}

function actionBtnStyle(color: string): React.CSSProperties {
  return {
    padding: "5px 12px", borderRadius: "6px",
    border: `1.5px solid ${color}`, background: "white",
    color: color, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
    fontFamily: "DM Sans, system-ui, sans-serif",
    whiteSpace: "nowrap",
  };
}
