"use client";

import { useState } from "react";
import type { Format } from "@/lib/scoring/types";
import { FORMAT_LABELS } from "@/lib/format/copy";
import FormatPicker from "./FormatPicker";
import DangerModal from "@/app/thomas-admin/components/DangerModal";

interface FormatChipProps {
  roundId: number;
  currentFormat: Format;
  formatLocked: boolean;
  onChange?: () => void;
}

const C = {
  navy: "#0b2d50",
  bg: "#fff",
  cardBorder: "#e4e4e4",
  pillBg: "#eef2f7",
  pillText: "#0b2d50",
  text: "#1a1a1a",
  subtext: "#64748b",
  font: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
};

export default function FormatChip({ roundId, currentFormat, formatLocked, onChange }: FormatChipProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);

  const editable = typeof onChange === "function";
  const { title } = FORMAT_LABELS[currentFormat];

  function handleTap() {
    if (!editable) return;
    if (formatLocked) {
      setDangerOpen(true);
    } else {
      setPickerOpen(true);
    }
  }

  function handleConfirmChange() {
    setDangerOpen(false);
    setPickerOpen(true);
  }

  function handlePickerSaved() {
    if (onChange) onChange();
  }

  return (
    <>
      <div
        role={editable ? "button" : undefined}
        tabIndex={editable ? 0 : undefined}
        onClick={editable ? handleTap : undefined}
        onKeyDown={editable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleTap(); } } : undefined}
        style={{
          display: "inline-flex", alignItems: "center", gap: 10,
          padding: "8px 12px",
          background: C.bg,
          border: `0.5px solid ${C.cardBorder}`,
          borderRadius: 10,
          cursor: editable ? "pointer" : "default",
          fontFamily: C.font,
          maxWidth: "100%",
        }}
      >
        <span style={{
          fontSize: "0.62rem", fontWeight: 800,
          textTransform: "uppercase", letterSpacing: "0.06em",
          background: C.pillBg, color: C.pillText,
          padding: "2px 8px", borderRadius: 999,
        }}>
          Format
        </span>
        <span style={{
          fontSize: "0.9rem", fontWeight: 600, color: C.text,
        }}>
          {title}
        </span>
        {formatLocked && (
          <span
            aria-label="locked"
            title="Locked — first score entered"
            style={{ display: "inline-flex", alignItems: "center", color: C.subtext }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
        )}
        {editable && (
          <span style={{
            fontSize: "0.78rem", fontWeight: 600, color: C.navy,
            marginLeft: "auto", paddingLeft: 4,
          }}>
            Change
          </span>
        )}
      </div>

      {dangerOpen && (
        <DangerModal
          title="Change format mid-round?"
          description={`Scores will be re-totaled under the new format.`}
          confirmLabel="Change format"
          onConfirm={handleConfirmChange}
          onCancel={() => setDangerOpen(false)}
        />
      )}

      <FormatPicker
        open={pickerOpen}
        roundId={roundId}
        currentFormat={currentFormat}
        onClose={() => setPickerOpen(false)}
        onSaved={handlePickerSaved}
      />
    </>
  );
}
