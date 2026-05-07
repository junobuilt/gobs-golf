"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useIsMobile } from "@/lib/useIsMobile";
import type { Format } from "@/lib/scoring/types";
import { FORMAT_ORDER, FORMAT_LABELS } from "@/lib/format/copy";
import { defaultConfigFor } from "@/lib/format/helpers";

interface FormatPickerProps {
  open: boolean;
  roundId: number;
  onClose: () => void;
  onSaved: (chosen: Format) => void;
}

const C = {
  navy: "#0b2d50",
  midNavy: "#0e4270",
  gold: "#e8a800",
  goldText: "#1a1a1a",
  bg: "#f2f1ed",
  cardBorder: "#e4e4e4",
  text: "#1a1a1a",
  subtext: "#64748b",
  errorBg: "#fef2f2",
  errorBorder: "#fca5a5",
  errorText: "#a32d2d",
  font: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
};

export default function FormatPicker({ open, roundId, onClose, onSaved }: FormatPickerProps) {
  const isMobile = useIsMobile();
  const [savingFormat, setSavingFormat] = useState<Format | null>(null);
  const [errorFormat, setErrorFormat] = useState<Format | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSavingFormat(null);
      setErrorFormat(null);
      setErrorMessage(null);
    }
  }, [open]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  async function pickFormat(chosen: Format) {
    if (savingFormat) return;
    setSavingFormat(chosen);
    setErrorFormat(null);
    setErrorMessage(null);

    const { error } = await supabase
      .from("rounds")
      .update({
        format: chosen,
        format_config: defaultConfigFor(chosen),
      })
      .eq("id", roundId);

    if (error) {
      setSavingFormat(null);
      setErrorFormat(chosen);
      setErrorMessage(error.message || "Couldn't save format. Tap to retry.");
      return;
    }

    onSaved(chosen);
    onClose();
  }

  const containerStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed", left: 0, right: 0, bottom: 0,
        background: "#fff",
        borderTopLeftRadius: 18, borderTopRightRadius: 18,
        boxShadow: "0 -8px 32px rgba(0,0,0,0.18)",
        padding: "12px 16px 28px",
        maxHeight: "90vh", overflowY: "auto",
      }
    : {
        position: "relative",
        background: "#fff",
        borderRadius: 14,
        maxWidth: 520, width: "100%",
        padding: "24px 24px 22px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        maxHeight: "85vh", overflowY: "auto",
      };

  const overlayStyle: React.CSSProperties = {
    position: "fixed", inset: 0, zIndex: 1000,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: isMobile ? "flex-end" : "center",
    justifyContent: "center",
    padding: isMobile ? 0 : 24,
    fontFamily: C.font,
  };

  return (
    <div
      style={overlayStyle}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Choose today's format"
    >
      <div
        style={containerStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {isMobile && (
          <div style={{
            width: 44, height: 4, borderRadius: 999,
            background: "#cbd5e1",
            margin: "0 auto 14px",
          }} />
        )}

        <div style={{ marginBottom: 16 }}>
          <h2 style={{
            margin: "0 0 4px",
            fontSize: isMobile ? "1.15rem" : "1.25rem",
            fontWeight: 700,
            color: C.navy,
            letterSpacing: "-0.01em",
          }}>
            Choose today&apos;s format
          </h2>
          <p style={{
            margin: 0,
            fontSize: "0.85rem",
            color: C.subtext,
            lineHeight: 1.4,
          }}>
            Format locks once the first score is entered.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {FORMAT_ORDER.map((f) => {
            const { title, oneLiner } = FORMAT_LABELS[f];
            const isSaving = savingFormat === f;
            const hasError = errorFormat === f;
            const otherSaving = savingFormat !== null && savingFormat !== f;
            return (
              <button
                key={f}
                onClick={() => pickFormat(f)}
                disabled={otherSaving}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 12,
                  width: "100%",
                  padding: "14px 16px",
                  border: hasError
                    ? `1.5px solid ${C.errorBorder}`
                    : `0.5px solid ${C.cardBorder}`,
                  borderRadius: 10,
                  background: hasError ? C.errorBg : "#fff",
                  textAlign: "left",
                  cursor: otherSaving ? "default" : "pointer",
                  opacity: otherSaving ? 0.5 : 1,
                  fontFamily: C.font,
                  transition: "border-color 0.15s, background 0.15s",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    color: C.text,
                    marginBottom: 2,
                  }}>
                    {title}
                  </div>
                  <div style={{
                    fontSize: "0.8rem",
                    color: C.subtext,
                    lineHeight: 1.4,
                  }}>
                    {oneLiner}
                  </div>
                </div>
                {isSaving && (
                  <span style={{
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    color: C.navy,
                    alignSelf: "center",
                  }}>
                    Saving…
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {errorMessage && (
          <div style={{
            marginTop: 14,
            padding: "10px 12px",
            background: C.errorBg,
            border: `1px solid ${C.errorBorder}`,
            borderRadius: 8,
            fontSize: "0.82rem",
            color: C.errorText,
          }}>
            {errorMessage}
          </div>
        )}

        <button
          onClick={onClose}
          disabled={savingFormat !== null}
          style={{
            marginTop: 16, width: "100%", padding: "12px",
            background: "transparent",
            border: `1px solid ${C.cardBorder}`,
            borderRadius: 10,
            color: C.subtext,
            fontSize: "0.9rem",
            fontWeight: 500,
            cursor: savingFormat !== null ? "default" : "pointer",
            opacity: savingFormat !== null ? 0.5 : 1,
            fontFamily: C.font,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
