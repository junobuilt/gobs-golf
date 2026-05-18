"use client";

// D.1 S1 — per-player overflow menu shared by the live scorecard and the
// admin active-view team cards. Consolidates three actions onto one row:
//   - Mark [Name] as left round  (writes dropped_after_hole)
//   - Undo left round            (clears dropped_after_hole)
//   - Remove from round          (delegated to parent via onRemove)
// Per the May 17 design call, splitting Remove + Mark Left into separate
// adjacent icons risked mis-tap for the 60–80 demographic. One ⋯ icon, one
// menu, three labels.
//
// Owns the mark-dropout modal (hole picker 1..17 + consequence text) and
// the undo confirm. Writes round_players.dropped_after_hole and the audit
// row in round_player_actions; calls onChanged() so the parent can refresh
// local state. Hides "Undo" when not currently dropped; hides Mark/Undo
// entirely when the round is finalized (read-only). Always exposes Remove
// (parent decides if it's safe — e.g., live scorecard while round is open).

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import DangerModal from "@/app/thomas-admin/components/DangerModal";

export interface PlayerOverflowMenuProps {
  roundPlayerId: number;
  playerName: string;
  droppedAfterHole: number | null;
  isRoundComplete: boolean;
  surface: "admin" | "scorecard";
  onChanged: () => void; // called after a successful mark/undo write
  onRemove?: () => void; // called when user picks Remove; parent owns the action
  removeLabel?: string;  // override the menu copy (default: "Remove from round")
}

const MENU_BG = "#ffffff";
const MENU_BORDER = "#e5e7eb";
const MENU_TEXT = "#1f2937";
const MENU_DANGER = "#a32d2d";
const MENU_HOVER = "#f3f4f6";

export default function PlayerOverflowMenu({
  roundPlayerId,
  playerName,
  droppedAfterHole,
  isRoundComplete,
  surface,
  onChanged,
  onRemove,
  removeLabel = "Remove from round",
}: PlayerOverflowMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [markModalOpen, setMarkModalOpen] = useState(false);
  const [undoModalOpen, setUndoModalOpen] = useState(false);
  const [pickedHole, setPickedHole] = useState<number>(
    droppedAfterHole ?? 9,
  );
  const [busy, setBusy] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Dismiss menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        menuRef.current && menuRef.current.contains(t)
      ) return;
      if (buttonRef.current && buttonRef.current.contains(t)) return;
      setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function confirmMark() {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase
      .from("round_players")
      .update({ dropped_after_hole: pickedHole })
      .eq("id", roundPlayerId);
    if (!error) {
      // Audit row. Best-effort: errors here don't block the mark.
      await supabase.from("round_player_actions").insert({
        round_player_id: roundPlayerId,
        action: "mark_dropout",
        hole: pickedHole,
        surface,
      });
      onChanged();
    }
    setBusy(false);
    setMarkModalOpen(false);
  }

  async function confirmUndo() {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase
      .from("round_players")
      .update({ dropped_after_hole: null })
      .eq("id", roundPlayerId);
    if (!error) {
      await supabase.from("round_player_actions").insert({
        round_player_id: roundPlayerId,
        action: "undo_dropout",
        hole: droppedAfterHole,
        surface,
      });
      onChanged();
    }
    setBusy(false);
    setUndoModalOpen(false);
  }

  const showMarkOption = !isRoundComplete && droppedAfterHole == null;
  const showUndoOption = !isRoundComplete && droppedAfterHole != null;
  const showRemoveOption = !isRoundComplete && !!onRemove;

  // If nothing is actionable, hide the button entirely.
  if (!showMarkOption && !showUndoOption && !showRemoveOption) {
    return null;
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Open actions for ${playerName}`}
        aria-haspopup="true"
        aria-expanded={menuOpen}
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen(o => !o);
        }}
        style={{
          width: 32, height: 32, borderRadius: 8,
          border: "none", background: "transparent",
          color: "#6b7280", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 0, fontFamily: "inherit",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>

      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          onClick={e => e.stopPropagation()}
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            background: MENU_BG,
            border: `1px solid ${MENU_BORDER}`,
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            minWidth: 200,
            zIndex: 50,
            overflow: "hidden",
            fontFamily: "inherit",
          }}
        >
          {showMarkOption && (
            <MenuItem
              label="Mark as left round"
              onClick={() => {
                setMenuOpen(false);
                setPickedHole(9);
                setMarkModalOpen(true);
              }}
            />
          )}
          {showUndoOption && (
            <MenuItem
              label="Undo left round"
              onClick={() => {
                setMenuOpen(false);
                setUndoModalOpen(true);
              }}
            />
          )}
          {showRemoveOption && (
            <MenuItem
              label={removeLabel}
              danger
              onClick={() => {
                setMenuOpen(false);
                onRemove?.();
              }}
            />
          )}
        </div>
      )}

      {markModalOpen && (
        <MarkDropoutModal
          playerName={playerName}
          pickedHole={pickedHole}
          onPick={setPickedHole}
          onCancel={() => setMarkModalOpen(false)}
          onConfirm={confirmMark}
          busy={busy}
        />
      )}

      {undoModalOpen && droppedAfterHole != null && (
        <DangerModal
          title={`Undo left round for ${playerName}?`}
          description={`${playerName} will be active again. Scores on holes ${droppedAfterHole + 1}–18 can be entered.`}
          cannotBeUndone={false}
          confirmLabel="Undo"
          onConfirm={confirmUndo}
          onCancel={() => setUndoModalOpen(false)}
        />
      )}
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: "100%",
        textAlign: "left",
        background: hover ? MENU_HOVER : "transparent",
        border: "none",
        padding: "11px 14px",
        fontSize: "0.9rem",
        fontWeight: 500,
        color: danger ? MENU_DANGER : MENU_TEXT,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}

// Two-step mark-dropout modal: title, hole picker, consequence preview,
// Cancel / Mark as left. Reuses the dangerous-action visual pattern, but
// the body is custom (the standard DangerModal takes only text), so this
// is its own component rather than threading a `children` slot through
// DangerModal. 1.5s confirm delay matches DangerModal's pattern.
function MarkDropoutModal({
  playerName,
  pickedHole,
  onPick,
  onCancel,
  onConfirm,
  busy,
}: {
  playerName: string;
  pickedHole: number;
  onPick: (n: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const [canConfirm, setCanConfirm] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setCanConfirm(true), 1500);
    return () => clearTimeout(t);
  }, []);

  const consequence =
    `${playerName}'s scores on holes 1–${pickedHole} stay as entered. ` +
    `Holes ${pickedHole + 1}–18 will be filled by blind draw at round end.`;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }}>
      <div style={{
        background: "white", borderRadius: 16, padding: "28px 24px",
        maxWidth: 420, width: "100%",
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        fontFamily: "DM Sans, system-ui, sans-serif",
      }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 52, height: 52, borderRadius: "50%",
            background: "#fff7ed", border: "2px solid #fdba74",
          }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
                 stroke="#9a3412" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            </svg>
          </div>
        </div>

        <h2 style={{
          margin: "0 0 6px", textAlign: "center",
          fontSize: "1.1rem", fontWeight: 700, color: "#0c3057",
        }}>
          Mark {playerName} as left round?
        </h2>
        <p style={{
          margin: "0 0 14px", textAlign: "center",
          fontSize: "0.88rem", color: "#4b5563",
        }}>
          Which hole did {playerName} play through?
        </p>

        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <select
            value={pickedHole}
            onChange={e => onPick(parseInt(e.target.value, 10))}
            style={{
              padding: "10px 14px",
              fontSize: "1rem",
              borderRadius: 8,
              border: "1.5px solid #d1d5db",
              fontFamily: "inherit",
              background: "white",
              minWidth: 100,
            }}
          >
            {Array.from({ length: 17 }, (_, i) => i + 1).map(h => (
              <option key={h} value={h}>Hole {h}</option>
            ))}
          </select>
        </div>

        <p style={{
          margin: "0 0 22px",
          textAlign: "center",
          fontSize: "0.82rem",
          color: "#6b7280",
          lineHeight: 1.5,
          padding: "0 4px",
        }}>
          {consequence}
        </p>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              flex: 1, padding: 13, borderRadius: 10,
              border: "1.5px solid #d1d5db", background: "white",
              fontSize: "0.95rem", fontWeight: 600, color: "#374151",
              cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm || busy}
            style={{
              flex: 1, padding: 13, borderRadius: 10, border: "none",
              background: canConfirm && !busy ? "#9a3412" : "#f3f4f6",
              color: canConfirm && !busy ? "white" : "#9ca3af",
              fontSize: "0.95rem", fontWeight: 600,
              cursor: canConfirm && !busy ? "pointer" : "not-allowed",
              fontFamily: "inherit",
            }}
          >
            {busy ? "Saving…" : canConfirm ? "Mark as left" : "Wait…"}
          </button>
        </div>
      </div>
    </div>
  );
}
