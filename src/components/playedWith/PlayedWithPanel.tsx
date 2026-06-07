"use client";

// Played With — egocentric four-bucket render (Phase E).
//
// Extracted 2026-06-06 (E6) from the player-profile inline panel so the
// profile (E5) and the admin Player View section (E6) share one render. The
// computation lives in `@/lib/playedWith/compute`; this component is a pure
// render of its `{ partners, neverPlayed }` output.
//
// Buckets are derived here from `rounds_together` (6+ / 3–5 / 1–2 / 0), per
// the locked Played With v2 thresholds. Pills carry player_id and navigate to
// that player's page (locked pattern).

import { useState } from "react";
import Link from "next/link";
import type { Partner, NeverPlayed } from "@/lib/playedWith/compute";

const NEVER_PLAYED_CAP = 20;

function partnerSort(a: Partner, b: Partner) {
  return (
    b.rounds_together - a.rounds_together ||
    a.display_name.localeCompare(b.display_name)
  );
}

export default function PlayedWithPanel({
  partners,
  neverPlayed,
  seasonScoped,
  focalPlayerName,
}: {
  partners: Partner[];
  neverPlayed: NeverPlayed[];
  // When true, the view is scoped to the active season — empty-partner copy
  // reads "this season" rather than the all-time "Not yet" per bucket.
  seasonScoped: boolean;
  // When provided, third-person "{name} has played with everyone" copy is used
  // (admin surface). Omitted on the player profile → second-person "You've…".
  focalPlayerName?: string;
}) {
  // Show-all state for the (long) never-played bucket. Internalized here so both
  // call sites get it for free (it was lifted to the profile page pre-E6).
  const [showAllNever, setShowAllNever] = useState(false);

  const sorted = [...partners].sort(partnerSort);
  const mostFrequent = sorted.filter((p) => p.rounds_together >= 6);
  const someHistory = sorted.filter(
    (p) => p.rounds_together >= 3 && p.rounds_together <= 5
  );
  const onceOrTwice = sorted.filter(
    (p) => p.rounds_together >= 1 && p.rounds_together <= 2
  );
  const neverSorted = [...neverPlayed].sort((a, b) =>
    a.display_name.localeCompare(b.display_name)
  );
  const neverVisible = showAllNever
    ? neverSorted
    : neverSorted.slice(0, NEVER_PLAYED_CAP);
  const neverHasMore = neverSorted.length > NEVER_PLAYED_CAP;

  const everyoneCopy = focalPlayerName
    ? `${focalPlayerName} has played with everyone`
    : "You've played with everyone";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {seasonScoped && partners.length === 0 ? (
        <div style={{
          fontStyle: "italic",
          color: "var(--text-muted)",
          fontSize: "0.85rem",
        }}>
          No partners this season yet
        </div>
      ) : (
        <>
          <BucketSection title="Most frequent · 6+ rounds">
            {mostFrequent.length === 0 ? (
              <NotYet />
            ) : (
              <FrequentBars partners={mostFrequent} />
            )}
          </BucketSection>

          <BucketSection title="Some history · 3–5 rounds">
            {someHistory.length === 0 ? (
              <NotYet />
            ) : (
              <PillRow
                partners={someHistory}
                bg="var(--green-100)"
                color="var(--green-800)"
                showCount
              />
            )}
          </BucketSection>

          <BucketSection title="Just once or twice · 1–2 rounds">
            {onceOrTwice.length === 0 ? (
              <NotYet />
            ) : (
              <PillRow
                partners={onceOrTwice}
                bg="var(--cream-dark)"
                color="var(--text-secondary)"
                showCount
              />
            )}
          </BucketSection>
        </>
      )}

      <BucketSection title="Never played together · 0 rounds">
        {neverSorted.length === 0 ? (
          <div style={{
            fontStyle: "italic",
            color: "var(--text-muted)",
            fontSize: "0.85rem",
          }}>
            {everyoneCopy}
          </div>
        ) : (
          <>
            <PillRow
              partners={neverVisible.map((n) => ({
                id: n.id,
                display_name: n.display_name,
                rounds_together: 0,
              }))}
              bg="var(--red-100)"
              color="var(--red-500)"
              showCount={false}
            />
            {neverHasMore && (
              <button
                type="button"
                onClick={() => setShowAllNever((v) => !v)}
                style={{
                  marginTop: "8px",
                  background: "transparent",
                  border: "none",
                  color: "var(--green-700)",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: "4px 0",
                  textAlign: "left",
                }}
              >
                {showAllNever
                  ? "Show fewer"
                  : `Show all (${neverSorted.length})`}
              </button>
            )}
          </>
        )}
      </BucketSection>
    </div>
  );
}

function BucketSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{
        fontSize: "0.72rem",
        fontWeight: 700,
        color: "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginBottom: "8px",
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function NotYet() {
  return (
    <div style={{
      fontStyle: "italic",
      color: "var(--text-muted)",
      fontSize: "0.85rem",
    }}>
      Not yet
    </div>
  );
}

function FrequentBars({ partners }: { partners: Partner[] }) {
  const max = partners[0]?.rounds_together || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {partners.map((p) => {
        const widthPct = Math.max(8, (p.rounds_together / max) * 100);
        return (
          <Link
            key={p.id}
            href={`/player/${p.id}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "8px 10px",
              borderRadius: "8px",
              textDecoration: "none",
              background: "var(--green-50)",
              color: "var(--text-primary)",
            }}
          >
            <span style={{
              flex: "0 0 auto",
              minWidth: "100px",
              fontSize: "0.9rem",
              fontWeight: 600,
            }}>
              {p.display_name}
            </span>
            <div style={{
              flex: "1 1 auto",
              height: "8px",
              background: "var(--green-100)",
              borderRadius: "999px",
              overflow: "hidden",
            }}>
              <div style={{
                width: `${widthPct}%`,
                height: "100%",
                background: "var(--green-700)",
                borderRadius: "999px",
              }} />
            </div>
            <span style={{
              flex: "0 0 auto",
              minWidth: "32px",
              textAlign: "right",
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "var(--green-900)",
            }}>
              {p.rounds_together}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function PillRow({
  partners,
  bg,
  color,
  showCount,
}: {
  partners: Partner[];
  bg: string;
  color: string;
  showCount: boolean;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {partners.map((p) => (
        <Link
          key={p.id}
          href={`/player/${p.id}`}
          style={{
            display: "inline-block",
            padding: "5px 11px",
            borderRadius: "999px",
            background: bg,
            color,
            fontSize: "0.85rem",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {showCount
            ? `${p.display_name} · ${p.rounds_together}`
            : p.display_name}
        </Link>
      ))}
    </div>
  );
}
