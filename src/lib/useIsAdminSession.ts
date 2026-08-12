// useIsAdminSession — "is this device an admin?" for PUBLIC routes (the
// tournament scorecard). The admin cookies are httpOnly, so the client can't
// read them; this hook asks the server once via GET /api/admin/status.
//
// Contract (see the Clear-hole feature):
//   • Calls the route ONCE per page load; the result is cached module-wide so
//     every component on the page shares the single request (no per-mount refetch).
//   • Returns `false` while loading AND on any error — DEFAULT CLOSED, so admin
//     UI never flashes before the check resolves and a failed check never opens
//     the gate.
//   • No polling. A revoke is honoured on the NEXT full page load (a reload
//     clears this module cache), which matches the backup-PIN revoke behaviour.

"use client";

import { useEffect, useState } from "react";

let cached: Promise<boolean> | null = null;

function loadIsAdmin(): Promise<boolean> {
  if (cached) return cached;
  cached = fetch("/api/admin/status", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : { isAdmin: false }))
    .then((d: { isAdmin?: unknown }) => d?.isAdmin === true)
    .catch(() => false);
  return cached;
}

export function useIsAdminSession(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let active = true;
    loadIsAdmin().then((v) => {
      if (active) setIsAdmin(v);
    });
    return () => {
      active = false;
    };
  }, []);
  return isAdmin;
}

// Test-only: drop the module cache so each test starts from an unfetched state.
export function resetIsAdminSessionCacheForTesting(): void {
  cached = null;
}
