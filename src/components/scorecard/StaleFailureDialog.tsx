"use client";

/**
 * Phase E — stale-failure prompt shown on homepage mount when the queue
 * has terminal_failure items left over from a prior session. Two
 * variants, mirroring Phase D's flow but with Forget instead of
 * Skip/Finish-anyway since the round is already finalized:
 *
 *  - "first":  "N scores from your last round still need to sync"
 *              [Retry] [View details] [Forget]
 *  - "second": Same shell as Phase D's second-attempt, but with Forget
 *              replacing Finish anyway:
 *              [Try Again] [Copy details] [Forget]
 *
 * Forget always routes through a DangerModal confirmation. Dismissal
 * (overlay click or Escape) is the caller's responsibility — the dialog
 * just invokes onDismiss.
 */

import { useEffect, useState } from "react";
import type { QueueItem } from "@/lib/writeQueue";
import DangerModal from "@/app/admin/components/DangerModal";

interface StaleFailureDialogProps {
  items: QueueItem[];
  /** Returns true if all items synced; false if some still failing. */
  onRetry: () => Promise<boolean>;
  onForget: () => void;
  onCopyDetails: () => void;
  onDismiss: () => void;
  copyState: "idle" | "copied";
}

const FONT = "DM Sans, system-ui, sans-serif";

export default function StaleFailureDialog({
  items,
  onRetry,
  onForget,
  onCopyDetails,
  onDismiss,
  copyState,
}: StaleFailureDialogProps) {
  const [variant, setVariant] = useState<"first" | "second">("first");
  const [showDetails, setShowDetails] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [forgetConfirm, setForgetConfirm] = useState(false);

  // Escape key triggers dismiss — except while the Forget confirm modal
  // is open, in which case Escape is swallowed by the DangerModal layer
  // and we don't want it to also dismiss the parent dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !forgetConfirm) onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss, forgetConfirm]);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const success = await onRetry();
      if (!success) setVariant("second");
    } finally {
      setRetrying(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    // Don't dismiss while the Forget confirm modal is up.
    if (forgetConfirm) return;
    if (e.target === e.currentTarget) onDismiss();
  };

  return (
    <>
      <div
        role="dialog"
        aria-labelledby="stale-failure-title"
        aria-modal="true"
        onClick={handleOverlayClick}
        data-testid="stale-failure-overlay"
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
          onClick={e => e.stopPropagation()}
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
          {/* Amber warning icon — matches Phase D ReconciliationDialog. */}
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

          {/* D.1: when every stuck item failed because the round was
              already finalized, the user can never "sync" these — the DB
              rejects them. Show specific copy and route Retry/Try Again
              into a no-op the user can ignore. Forget is still useful to
              clear them from the queue. */}
          {(() => {
            const allFinalized = items.length > 0
              && items.every(i => i.terminal_reason === "round_finalized");
            const title = allFinalized
              ? `Round was finalized — ${items.length} ${items.length === 1 ? "score" : "scores"} can no longer be edited`
              : variant === "first"
                ? `${items.length} ${items.length === 1 ? "score" : "scores"} from your last round still need${items.length === 1 ? "s" : ""} to sync`
                : `Still couldn't sync ${items.length} ${items.length === 1 ? "score" : "scores"}.`;
            const subtitle = allFinalized
              ? "These edits were attempted after the round closed. Tap Forget to clear them, or contact Jonathan if a real correction is needed."
              : variant === "second"
                ? "Try again later when you have better signal. If this keeps happening, contact admin."
                : null;
            return (
              <>
                <h2
                  id="stale-failure-title"
                  style={{
                    margin: "0 0 8px",
                    textAlign: "center",
                    fontSize: "1.1rem",
                    fontWeight: 700,
                    color: "#0c3057",
                    lineHeight: 1.35,
                  }}
                >
                  {title}
                </h2>
                {subtitle && (
                  <p
                    style={{
                      margin: "0 0 14px",
                      textAlign: "center",
                      fontSize: "0.88rem",
                      color: "#4b5563",
                      lineHeight: 1.5,
                    }}
                  >
                    {subtitle}
                  </p>
                )}
              </>
            );
          })()}

          <ul
            data-testid="stale-failure-list"
            style={{
              listStyle: "none",
              padding: 0,
              margin: "12px 0 22px",
              maxHeight: "200px",
              overflowY: "auto",
              border: "1px solid #f1f5f9",
              borderRadius: "10px",
              background: "#f9fafb",
            }}
          >
            {items.map((item, i) => (
              <li
                key={item.id}
                style={{
                  padding: "10px 14px",
                  fontSize: "0.88rem",
                  color: "#1f2937",
                  borderBottom: i < items.length - 1 ? "1px solid #f1f5f9" : "none",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  flexWrap: "wrap",
                }}
              >
                <span>
                  {item.display.hole_label} — {item.display.player_name}
                </span>
                <span style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  {showDetails && (
                    <span style={{ color: "#6b7280", fontSize: "0.78rem" }}>
                      {formatItemDate(item)}
                    </span>
                  )}
                  <span style={{ fontWeight: 700, color: "#0c3057" }}>{item.payload.strokes}</span>
                </span>
              </li>
            ))}
          </ul>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {variant === "first" ? (
              <>
                <button
                  onClick={handleRetry}
                  disabled={retrying}
                  style={primaryButtonStyle(retrying)}
                >
                  {retrying ? "Retrying…" : "Retry"}
                </button>
                <button
                  onClick={() => setShowDetails(s => !s)}
                  disabled={retrying}
                  style={secondaryButtonStyle(retrying)}
                >
                  {showDetails ? "Hide details" : "View details"}
                </button>
                <button
                  onClick={() => setForgetConfirm(true)}
                  disabled={retrying}
                  style={forgetButtonStyle(retrying)}
                >
                  Forget
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleRetry}
                  disabled={retrying}
                  style={primaryButtonStyle(retrying)}
                >
                  {retrying ? "Retrying…" : "Try Again"}
                </button>
                <button
                  onClick={onCopyDetails}
                  disabled={retrying}
                  style={copyButtonStyle(retrying, copyState)}
                >
                  {copyState === "copied" ? "Copied ✓" : "Copy details"}
                </button>
                <button
                  onClick={() => setForgetConfirm(true)}
                  disabled={retrying}
                  style={forgetButtonStyle(retrying)}
                >
                  Forget
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {forgetConfirm && (
        <DangerModal
          title="Permanently delete these unsaved scores?"
          description={`${items.length} ${
            items.length === 1 ? "score" : "scores"
          } will be removed from the queue and will never appear in the league record. This cannot be undone.`}
          confirmLabel="Forget"
          onConfirm={() => {
            setForgetConfirm(false);
            onForget();
          }}
          onCancel={() => setForgetConfirm(false)}
        />
      )}
    </>
  );
}

function formatItemDate(item: QueueItem): string {
  const dateStr = item.display.round_date;
  if (dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
  }
  // Fall back to enqueued_at for items written before Phase E (no
  // round_date on the display struct).
  const fallback = new Date(item.enqueued_at);
  if (!isNaN(fallback.getTime())) {
    return fallback.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return "?";
}

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    width: "100%",
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
    width: "100%",
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
    width: "100%",
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

function forgetButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "13px",
    borderRadius: "10px",
    border: "1.5px solid #fca5a5",
    background: "white",
    fontSize: "0.95rem",
    fontWeight: 600,
    color: disabled ? "#9ca3af" : "#a32d2d",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: FONT,
  };
}
