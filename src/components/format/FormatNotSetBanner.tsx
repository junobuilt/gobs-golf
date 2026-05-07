"use client";

import { useState } from "react";
import FormatPicker from "./FormatPicker";
import type { Format } from "@/lib/scoring/types";

interface FormatNotSetBannerProps {
  roundId: number;
  onChosen: () => void;
}

const C = {
  gold: "#e8a800",
  goldDeep: "#b88500",
  text: "#1a1a1a",
  font: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
};

export default function FormatNotSetBanner({ roundId, onChosen }: FormatNotSetBannerProps) {
  const [open, setOpen] = useState(false);

  function handleSaved(_chosen: Format) {
    onChosen();
  }

  return (
    <>
      <div
        role="status"
        style={{
          background: "#fff8e1",
          border: `1px solid ${C.gold}`,
          borderRadius: 10,
          padding: "12px 14px",
          marginBottom: 16,
          display: "flex", alignItems: "center", gap: 12,
          fontFamily: C.font,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: "0.88rem", fontWeight: 700, color: C.text,
            marginBottom: 2,
          }}>
            Format not set
          </div>
          <div style={{
            fontSize: "0.78rem", color: "#5b4400", lineHeight: 1.4,
          }}>
            Pick today&apos;s format to begin scoring.
          </div>
        </div>
        <button
          onClick={() => setOpen(true)}
          style={{
            background: C.gold,
            color: C.text,
            border: "none",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: "0.85rem",
            fontWeight: 700,
            cursor: "pointer",
            whiteSpace: "nowrap",
            fontFamily: C.font,
          }}
        >
          Choose Format
        </button>
      </div>

      <FormatPicker
        open={open}
        roundId={roundId}
        onClose={() => setOpen(false)}
        onSaved={handleSaved}
      />
    </>
  );
}
