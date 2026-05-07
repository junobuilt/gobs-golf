"use client";

interface ScorecardLockNoticeProps {
  adminName?: string;
}

const C = {
  navy: "#0b2d50",
  bg: "#f2f1ed",
  cardBorder: "#e4e4e4",
  subtext: "#475569",
  font: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
};

export default function ScorecardLockNotice({ adminName = "admin" }: ScorecardLockNoticeProps) {
  return (
    <div
      role="status"
      style={{
        background: "#fff",
        border: `0.5px solid ${C.cardBorder}`,
        borderRadius: 14,
        padding: "28px 22px",
        margin: "16px 0",
        textAlign: "center",
        fontFamily: C.font,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 44, height: 44, margin: "0 auto 14px",
          borderRadius: "50%",
          background: "#eef2f7",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
             stroke={C.navy} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h3 style={{
        margin: "0 0 6px",
        fontSize: "1rem",
        fontWeight: 700,
        color: C.navy,
      }}>
        Scorecard locked
      </h3>
      <p style={{
        margin: 0,
        fontSize: "0.85rem",
        color: C.subtext,
        lineHeight: 1.5,
        maxWidth: 320, marginLeft: "auto", marginRight: "auto",
      }}>
        Waiting for {adminName} to pick today&apos;s format. Scoring will unlock once a format is chosen.
      </p>
    </div>
  );
}
