// E2E — Backup Admin Access card (migration 028).
//
// SCOPE NOTE (honest coverage boundary): the backup-PIN DATA path is entirely
// server-side — mint/disable/status are server actions and the middleware
// re-check is an Edge fetch. The e2e harness mocks Supabase at the BROWSER layer
// only (installSupabaseMock route-intercepts browser requests), so server-side
// Supabase traffic from this feature leaves the Next process and is NOT
// intercepted. A faithful end-to-end mint→login→access walk-through would need
// a server-reachable mock (new infra, out of LEAN scope), so the credential
// logic is covered by vitest (backupPin / adminAuth-backup / middleware-backup /
// backupActions) instead. What Playwright CAN prove faithfully, and does here:
//   1. The Security card renders inside the admin gate (primary session works —
//      reaching /admin Settings at all exercises the unchanged primary path, R6).
//   2. The mint form (4-digit input, 1/3/7-day presets, Enable) is present.
//      getBackupPinStatus fails closed to "Inactive" against the e2e sentinel
//      host — the deterministic, correct fallback.

import { test, expect, seed } from "./support/fixtures";

test("Backup Admin Access card renders in admin Settings (primary gate intact)", async ({ page, db }) => {
  seed(db, {
    players: [],
    seasons: [{ id: 1, name: "2026 Season", is_active: true, status: "active" }],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
  });

  // Reaching the admin shell proves the primary admin_session gate still works
  // (storageState from global-setup; middleware primary path unchanged — R6).
  await page.goto("/admin");
  await page.getByRole("button", { name: "Settings" }).click();

  // The Security card + its controls render. (The status line resolves from a
  // server action that can't be intercepted by the browser-layer mock here, so
  // we assert the synchronously-rendered controls, not the status text.)
  await expect(page.getByText("Backup Admin Access")).toBeVisible();
  await expect(page.getByPlaceholder("4-digit PIN")).toBeVisible();
  await expect(page.getByRole("button", { name: "1 day" })).toBeVisible();
  await expect(page.getByRole("button", { name: "3 days" })).toBeVisible();
  await expect(page.getByRole("button", { name: "7 days" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Enable$/ })).toBeVisible();
});
