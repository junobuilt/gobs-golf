"use client";

/**
 * Phase D — "Finishing up..." overlay shown while the End-Round hail-mary
 * drain is in flight. After the 15s grace window, the optional "Skip and
 * finish" button appears so the user can bail out if their network is
 * stuck.
 */

interface FinishingSpinnerProps {
  showSkipButton: boolean;
  onSkip: () => void;
}

const FONT = "DM Sans, system-ui, sans-serif";

export default function FinishingSpinner({ showSkipButton, onSkip }: FinishingSpinnerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1050,
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
          padding: "32px 28px",
          maxWidth: "320px",
          width: "100%",
          textAlign: "center",
          fontFamily: FONT,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            margin: "0 auto 16px",
            width: "44px",
            height: "44px",
            border: "4px solid #e2e8f0",
            borderTopColor: "#0c3057",
            borderRadius: "50%",
            animation: "spin 0.9s linear infinite",
          }}
        />
        <div
          style={{
            fontSize: "1rem",
            fontWeight: 700,
            color: "#0c3057",
            marginBottom: "6px",
          }}
        >
          Finishing up…
        </div>
        <div
          style={{
            fontSize: "0.78rem",
            color: "#6b7280",
            lineHeight: 1.5,
          }}
        >
          Saving any unsynced scores before we wrap up the round.
        </div>

        {showSkipButton && (
          <button
            onClick={onSkip}
            style={{
              marginTop: "20px",
              width: "100%",
              padding: "11px",
              borderRadius: "10px",
              border: "1.5px solid #d1d5db",
              background: "white",
              fontSize: "0.9rem",
              fontWeight: 600,
              color: "#374151",
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            Skip and finish
          </button>
        )}
      </div>

      {/* Keyframes are scoped inline so the component is self-contained
          without depending on a global stylesheet rule. */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
