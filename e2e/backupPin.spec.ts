// E2E — Backup Admin Access card (v2, named holders — migration 043).
//
// SCOPE NOTE (honest coverage boundary — unchanged from v1 and re-verified this
// session): the backup-PIN DATA path is entirely server-side. assign / list /
// revoke are server ACTIONS and the middleware re-check is an Edge fetch. The
// e2e harness mocks Supabase at the BROWSER layer only (installSupabaseMock
// route-intercepts browser requests via `context.route`), so server-side
// Supabase traffic from this feature leaves the Next process and is NOT
// intercepted — it resolves against the deliberately non-resolvable e2e sentinel
// host and fails closed.
//
// Consequence, stated plainly: the walk-through of "assign two PINs → both
// appear → remove one → the removed holder can no longer log in" CANNOT be
// driven here. It would need a SERVER-REACHABLE mock (a PostgREST-subset HTTP
// server plus a different NEXT_PUBLIC_SUPABASE_URL for the dev server) — new
// infra that changes the env for all specs, deliberately not built on this
// branch. That behavior is instead covered by vitest, where it is exercised
// against the real code rather than a render:
//   - tests/lib/backupLogin.test.ts   — three simultaneous holders all log in;
//                                       revoking one leaves the others; expired
//                                       fails; the cookie binds to the MATCHING
//                                       credential (negative-controlled).
//   - tests/lib/backupActions.test.ts — assign/list/revoke rules, end-of-day
//                                       Vancouver expiry across DST.
//   - tests/components/backup-admin-card.test.tsx — the list, the pre-upgrade
//                                       branding, the remove confirmation copy,
//                                       and the one-time reveal.
//
// What Playwright CAN prove faithfully, and does here:
//   1. The Security card renders inside the admin gate — reaching /admin
//      Settings at all exercises the unchanged primary session path (R6).
//   2. The v2 assign form is wired: the PlayerCombobox is populated from the
//      browser-side roster query (which IS intercepted, so this is real), the
//      4-digit PIN field is present, and the native date input carries the
//      today..one-year-out bounds.
//   3. The v1 single-credential controls are GONE.
//   4. listBackupPins cannot reach the sentinel host, so the list renders its
//      LOAD-FAILURE state. That is the deterministic, correct fallback and it is
//      worth asserting: the card must never fall back to "No PINs assigned.",
//      which on a security screen reads as "nobody can get in" when the truth is
//      "we could not check".

import { test, expect, seed, ALL_PLAYERS, PLAYERS } from "./support/fixtures";

test.beforeEach(async ({ page, db }) => {
  seed(db, {
    players: ALL_PLAYERS,
    seasons: [{ id: 1, name: "2026 Season", is_active: true, status: "active" }],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
  });

  // Reaching the admin shell proves the primary admin_session gate still works
  // (storageState from global-setup; middleware primary path unchanged — R6).
  await page.goto("/admin");
  await page.getByRole("button", { name: "Settings" }).click();
});

test("Backup Admin Access card renders in admin Settings (primary gate intact)", async ({ page }) => {
  await expect(page.getByText("Backup Admin Access")).toBeVisible();
  await expect(page.getByText("People who can sign in as admin right now.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Assign PIN" })).toBeVisible();
});

test("a failed list read says so — it never claims nobody has access", async ({ page }) => {
  // Server actions can't reach the sentinel Supabase host from the Next process,
  // so this exercises the real load-failure path end to end.
  await expect(
    page.getByText(/Couldn.t load who has access\. Reload the page to try again\./)
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("No PINs assigned.")).toHaveCount(0);
});

test("the v1 single-credential controls are gone", async ({ page }) => {
  await expect(page.getByRole("button", { name: "1 day" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "3 days" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "7 days" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Enable$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Replace backup PIN/ })).toHaveCount(0);
});

test("the player picker is searchable and populated from the live roster", async ({ page }) => {
  const picker = page.getByLabel("Who is it for?");
  await expect(picker).toBeVisible();

  await picker.click();
  // Full names on this surface — it is a security list, and the admin needs to
  // know WHICH Wayne holds a credential.
  await expect(page.getByRole("option", { name: PLAYERS.wayneH.full_name })).toBeVisible();
  await expect(page.getByRole("option", { name: PLAYERS.wayneV.full_name })).toBeVisible();

  await picker.fill("Betty");
  await expect(page.getByRole("option", { name: PLAYERS.betty.full_name })).toBeVisible();
  await expect(page.getByRole("option", { name: PLAYERS.adam.full_name })).toHaveCount(0);

  await page.getByRole("option", { name: PLAYERS.betty.full_name }).click();
  await expect(picker).toHaveValue(PLAYERS.betty.full_name);
});

test("the expiry field is a native date input bounded to today..one year out", async ({ page }) => {
  const date = page.locator("#backup-pin-expiry");
  await expect(date).toHaveAttribute("type", "date");

  const min = await date.getAttribute("min");
  const max = await date.getAttribute("max");
  expect(min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(max).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  // min is TODAY, not tomorrow: the admin is often at the course handing a PIN
  // to a substitute for that same day, and expiry resolves to end-of-day.
  const todayVancouver = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  expect(min).toBe(todayVancouver);
  expect(Number(max!.slice(0, 4))).toBe(Number(min!.slice(0, 4)) + 1);

  // Defaults to roughly a month out, inside the bounds.
  const value = await date.inputValue();
  expect(value >= min!).toBe(true);
  expect(value <= max!).toBe(true);
});

test("the 4-digit PIN field accepts digits only", async ({ page }) => {
  const pin = page.locator("#backup-pin-digits");
  await pin.fill("");
  await pin.pressSequentially("12ab34567");
  await expect(pin).toHaveValue("1234");
});
