"use client";

import { useEffect, useState } from "react";

interface DangerModalProps {
  title: string;
  description: string;
  cannotBeUndone?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DangerModal({
  title,
  description,
  cannotBeUndone = true,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
}: DangerModalProps) {
  const [canConfirm, setCanConfirm] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setCanConfirm(true), 1500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "24px",
    }}>
      <div style={{
        background: "white", borderRadius: "16px", padding: "32px 28px",
        maxWidth: "420px", width: "100%",
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
      }}>
        {/* Warning icon */}
        <div style={{ textAlign: "center", marginBottom: "20px" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: "56px", height: "56px", borderRadius: "50%",
            background: "#fef2f2", border: "2px solid #fca5a5",
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#a32d2d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
        </div>

        <h2 style={{
          margin: "0 0 10px", textAlign: "center",
          fontSize: "1.15rem", fontWeight: 700, color: "#0c3057",
          fontFamily: "DM Sans, system-ui, sans-serif",
        }}>
          {title}
        </h2>

        <p style={{
          margin: "0 0 8px", textAlign: "center",
          fontSize: "0.9rem", color: "#4b5563", lineHeight: 1.5,
          fontFamily: "DM Sans, system-ui, sans-serif",
        }}>
          {description}
        </p>

        {cannotBeUndone && (
          <p style={{
            margin: "0 0 28px", textAlign: "center",
            fontSize: "0.8rem", color: "#a32d2d", fontWeight: 600,
            fontFamily: "DM Sans, system-ui, sans-serif",
          }}>
            This action cannot be undone.
          </p>
        )}

        {!cannotBeUndone && <div style={{ marginBottom: "28px" }} />}

        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: "13px", borderRadius: "10px",
              border: "1.5px solid #d1d5db", background: "white",
              fontSize: "0.95rem", fontWeight: 600, color: "#374151",
              cursor: "pointer", fontFamily: "DM Sans, system-ui, sans-serif",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            style={{
              flex: 1, padding: "13px", borderRadius: "10px",
              border: "none",
              background: canConfirm ? "#a32d2d" : "#f3f4f6",
              color: canConfirm ? "white" : "#9ca3af",
              fontSize: "0.95rem", fontWeight: 600,
              cursor: canConfirm ? "pointer" : "not-allowed",
              transition: "background 0.3s, color 0.3s",
              fontFamily: "DM Sans, system-ui, sans-serif",
            }}
          >
            {canConfirm ? confirmLabel : "Wait…"}
          </button>
        </div>
      </div>
    </div>
  );
}
