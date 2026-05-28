"use client";

// Pinned yellow banner shown on round-scoped pages whenever the admin is
// in edit mode (?admin=1&edit=1). Three states the banner discriminates
// (read on mount from rounds.is_complete + rounds.was_finalized):
//
//   is_complete=false AND was_finalized=true  → REOPENED. Show
//     "Finalize Round" — admin reopened a previously-finalized round
//     and needs to re-finalize when done. Tap → DangerModal →
//     finalizeRoundAdmin flips is_complete back to true.
//
//   is_complete=true (finalized, D1.11 admin edit-in-place) OR
//   is_complete=false AND was_finalized=false (live round, first
//   time being played) → show "Done" (existing behavior). Done drops
//   ?edit=1; round state is unchanged.
//
// Status fetched once on mount and never refreshed — banner shouldn't
// change mid-edit-session.

import { useEffect, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { exitRoundEditMode, useIsAdmin, useIsRoundEditMode } from "@/lib/admin";
import { supabase } from "@/lib/supabase";
import { finalizeRoundAdmin } from "@/lib/round/finalizeRoundAdmin";
import DangerModal from "@/app/admin/components/DangerModal";

export default function EditModeBanner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const routeParams = useParams();
  const isAdmin = useIsAdmin();
  const isEditing = useIsRoundEditMode();

  const roundIdRaw = routeParams?.id;
  const roundId = typeof roundIdRaw === "string" ? Number(roundIdRaw) : null;

  // `null` until the rounds row loads; once loaded we know whether to
  // show Finalize (true) or Done (false). Defaulting to `false` would
  // briefly flash Done on reopened rounds before the fetch resolved.
  const [showFinalize, setShowFinalize] = useState<boolean | null>(null);
  const [finalizeModalOpen, setFinalizeModalOpen] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  useEffect(() => {
    if (!isAdmin || !isEditing || roundId == null || Number.isNaN(roundId)) {
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("rounds")
        .select("is_complete, was_finalized")
        .eq("id", roundId)
        .maybeSingle();
      if (cancelled) return;
      const row = data as { is_complete?: boolean; was_finalized?: boolean } | null;
      // Reopened state = was_finalized AND no longer is_complete. Any
      // other combo (finalized in-place edit, live round) gets Done.
      setShowFinalize(!!row?.was_finalized && !row?.is_complete);
    })();
    return () => { cancelled = true; };
  }, [isAdmin, isEditing, roundId]);

  if (!isAdmin || !isEditing) return null;

  const handleDone = () => {
    exitRoundEditMode(router, pathname, params);
  };

  const handleFinalize = async () => {
    if (roundId == null || Number.isNaN(roundId)) return;
    setFinalizing(true);
    try {
      await finalizeRoundAdmin(roundId);
      setFinalizeModalOpen(false);
      exitRoundEditMode(router, pathname, params);
      // Hard reload so summary/scorecard re-fetch and pick up
      // is_complete = true (read-only state).
      router.refresh();
    } catch (err) {
      alert("Error finalizing round: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <>
      <div
        role="status"
        data-testid="edit-mode-banner"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          background: "#e8a800",
          color: "#1a1a1a",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontWeight: 600,
          fontSize: 14,
          boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
        }}
      >
        <span>
          {showFinalize
            ? "Editing reopened round. Tap Finalize Round when finished."
            : "Editing finalized round. Tap Done when finished."}
        </span>
        {showFinalize ? (
          <button
            onClick={() => setFinalizeModalOpen(true)}
            disabled={finalizing}
            data-testid="finalize-round-button"
            style={{
              background: "#0b2d50",
              color: "white",
              border: "none",
              borderRadius: 6,
              padding: "6px 14px",
              fontWeight: 700,
              fontSize: 14,
              cursor: finalizing ? "not-allowed" : "pointer",
              opacity: finalizing ? 0.6 : 1,
            }}
          >
            Finalize Round
          </button>
        ) : (
          <button
            onClick={handleDone}
            data-testid="edit-mode-done-button"
            style={{
              background: "#1a1a1a",
              color: "#e8a800",
              border: "none",
              borderRadius: 6,
              padding: "6px 14px",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Done
          </button>
        )}
      </div>
      {finalizeModalOpen && (
        <DangerModal
          title="Finalize this round?"
          description="Scores will be locked. Blind draws stay as they are."
          confirmLabel="Finalize"
          cannotBeUndone={false}
          onConfirm={handleFinalize}
          onCancel={() => setFinalizeModalOpen(false)}
        />
      )}
    </>
  );
}
