"use client";

// Pinned yellow banner shown on round-scoped pages whenever the admin is
// in edit mode (?admin=1&edit=1) on a finalized round. "Done" exits edit
// mode via exitRoundEditMode → router.replace drops ?edit=1, the banner
// unmounts, and the scorecard returns to read-only.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { exitRoundEditMode, useIsAdmin, useIsRoundEditMode } from "@/lib/admin";

export default function EditModeBanner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const isAdmin = useIsAdmin();
  const isEditing = useIsRoundEditMode();

  if (!isAdmin || !isEditing) return null;

  const handleDone = () => {
    exitRoundEditMode(router, pathname, params);
  };

  return (
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
      <span>Editing finalized round. Tap Done when finished.</span>
      <button
        onClick={handleDone}
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
    </div>
  );
}
