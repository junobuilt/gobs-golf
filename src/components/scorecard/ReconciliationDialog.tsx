"use client";

/**
 * Phase D — End-Round reconciliation dialog.
 *
 * Surfaced when the hail-mary drain (and optionally a Retry pass) didn't
 * clear all pending writes for the round. Two variants:
 *
 * - "first-attempt": "N scores didn't sync" + [Retry sync] [Skip and finish]
 * - "second-attempt": "Still couldn't sync N scores." + advice + [Try Again]
 *                     [Copy details] [Finish anyway]
 *
 * Styled to match the existing DangerModal aesthetic (full overlay, white
 * card, DM Sans, amber warning chrome instead of red — these are not
 * dangerous actions, just sync-failure notices).
 */

export interface StuckScoreItem {
  player_name: string;
  hole_label: string;
  strokes: number;
}

interface ReconciliationDialogProps {
  variant: "first-attempt" | "second-attempt";
  items: StuckScoreItem[];
  onRetry: () => void;
  onSkip: () => void;
  onCopyDetails?: () => void;
  copyState?: "idle" | "copied";
  busy?: boolean;
}

const FONT = "DM Sans, system-ui, sans-serif";

export default function ReconciliationDialog({
  variant,
  items,
  onRetry,
  onSkip,
  onCopyDetails,
  copyState = "idle",
  busy = false,
}: ReconciliationDialogProps) {
  const isFirst = variant === "first-attempt";

  return (
    <div
      role="dialog"
      aria-labelledby="reconciliation-dialog-title"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: "16px",
          padding: "28px 22px",
          maxWidth: "420px",
          width: "100%",
          maxHeight: "calc(100vh - 40px)",
          overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          fontFamily: FONT,
        }}
      >
        {/* Amber warning icon — softer than DangerModal's red triangle. */}
        <div style={{ textAlign: "center", marginBottom: "18px" }}>
          <div
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "52px",
              height: "52px",
              borderRadius: "50%",
              background: "#fef9c3",
              border: "2px solid #fcd34d",
            }}
          >
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#92400e"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="13" />
              <line x1="12" y1="16.5" x2="12.01" y2="16.5" />
            </svg>
          </div>
        </div>

        <h2
          id="reconciliation-dialog-title"
          style={{
            margin: "0 0 8px",
            textAlign: "center",
            fontSize: "1.1rem",
            fontWeight: 700,
            color: "#0c3057",
          }}
        >
          {isFirst
            ? `${items.length} ${items.length === 1 ? "score didn't" : "scores didn't"} sync`
            : `Still couldn't sync ${items.length} ${items.length === 1 ? "score" : "scores"}.`}
        </h2>

        {!isFirst && (
          <p
            style={{
              margin: "0 0 14px",
              textAlign: "center",
              fontSize: "0.88rem",
              color: "#4b5563",
              lineHeight: 1.5,
            }}
          >
            Try again later when you have better signal. If this keeps
            happening, contact admin.
          </p>
        )}

        {/* List of stuck items. Constrained max-height + scroll keeps the
            dialog usable on iPhone SE even with many items. */}
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: "12px 0 22px",
            maxHeight: "180px",
            overflowY: "auto",
            border: "1px solid #f1f5f9",
            borderRadius: "10px",
            background: "#f9fafb",
          }}
        >
          {items.map((item, i) => (
            <li
              key={i}
              style={{
                padding: "10px 14px",
                fontSize: "0.88rem",
                color: "#1f2937",
                borderBottom: i < items.length - 1 ? "1px solid #f1f5f9" : "none",
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
              }}
            >
              <span>
                {item.hole_label} — {item.player_name}
              </span>
              <span style={{ fontWeight: 700, color: "#0c3057" }}>{item.strokes}</span>
            </li>
          ))}
        </ul>

        <div
          style={{
            display: "flex",
            flexDirection: isFirst ? "row" : "column",
            gap: "10px",
          }}
        >
          {isFirst ? (
            <>
              <button
                onClick={onSkip}
                disabled={busy}
                style={secondaryButtonStyle(busy)}
              >
                Skip and finish
              </button>
              <button
                onClick={onRetry}
                disabled={busy}
                style={primaryButtonStyle(busy)}
              >
                {busy ? "Retrying…" : "Retry sync"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onRetry}
                disabled={busy}
                style={primaryButtonStyle(busy)}
              >
                {busy ? "Retrying…" : "Try Again"}
              </button>
              <button
                onClick={onCopyDetails}
                disabled={busy}
                style={copyButtonStyle(busy, copyState)}
              >
                {copyState === "copied" ? "Copied ✓" : "Copy details"}
              </button>
              <button
                onClick={onSkip}
                disabled={busy}
                style={secondaryButtonStyle(busy)}
              >
                Finish anyway
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "13px",
    borderRadius: "10px",
    border: "none",
    background: disabled ? "#cbd5e1" : "#0c3057",
    color: "white",
    fontSize: "0.95rem",
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: FONT,
    transition: "background 0.15s",
  };
}

function secondaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "13px",
    borderRadius: "10px",
    border: "1.5px solid #d1d5db",
    background: "white",
    fontSize: "0.95rem",
    fontWeight: 600,
    color: disabled ? "#9ca3af" : "#374151",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: FONT,
  };
}

function copyButtonStyle(disabled: boolean, copyState: "idle" | "copied"): React.CSSProperties {
  return {
    flex: 1,
    padding: "13px",
    borderRadius: "10px",
    border: "1.5px solid #d1d5db",
    background: copyState === "copied" ? "#dcfce7" : "white",
    fontSize: "0.95rem",
    fontWeight: 600,
    color: copyState === "copied" ? "#166534" : disabled ? "#9ca3af" : "#374151",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: FONT,
    transition: "background 0.15s, color 0.15s",
  };
}
