"use client";

// Searchable single-select player picker (Phase E6).
//
// No reusable single-select combobox existed (FormatPicker is a modal card
// list; PlayerPickerSheet is a multi-select bottom sheet), so this small one
// backs all the admin Played-With pickers. Purely presentational — options are
// pre-disambiguated + alphabetized by the caller.

import { useEffect, useRef, useState } from "react";

export type ComboOption = { id: number; label: string };

const C = {
  navy: "#0b2d50",
  border: "#e4e4e4",
  text: "#1f2937",
  muted: "#9ca3af",
  font: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
};

export default function PlayerCombobox({
  options,
  value,
  onChange,
  placeholder = "Search a player…",
  ariaLabel,
}: {
  options: ComboOption[];
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value) ?? null;

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q))
    : options;

  // When open the input shows the live query; when closed it shows the current
  // selection's label.
  const inputValue = open ? query : selected?.label ?? "";

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <div style={{ position: "relative" }}>
        <input
          aria-label={ariaLabel}
          value={inputValue}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          style={{
            width: "100%",
            padding: "10px 32px 10px 14px",
            border: `1px solid ${C.border}`,
            borderRadius: "8px",
            fontSize: "0.9rem",
            fontFamily: C.font,
            outline: "none",
            background: "white",
            color: C.text,
          }}
        />
        {selected && (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => {
              onChange(null);
              setQuery("");
              setOpen(false);
            }}
            style={{
              position: "absolute",
              right: "8px",
              top: "50%",
              transform: "translateY(-50%)",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: C.muted,
              fontSize: "1rem",
              lineHeight: 1,
              padding: "4px",
            }}
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 20,
            background: "white",
            border: `1px solid ${C.border}`,
            borderRadius: "8px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            maxHeight: "260px",
            overflowY: "auto",
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: "12px 14px", color: C.muted, fontSize: "0.85rem" }}>
              No player found
            </div>
          ) : (
            filtered.map((o) => {
              const isSel = o.id === value;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  onClick={() => {
                    onChange(o.id);
                    setQuery("");
                    setOpen(false);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 14px",
                    border: "none",
                    background: isSel ? "#f5f8fc" : "white",
                    color: C.text,
                    fontSize: "0.9rem",
                    fontWeight: isSel ? 700 : 500,
                    fontFamily: C.font,
                    cursor: "pointer",
                  }}
                >
                  {o.label}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
