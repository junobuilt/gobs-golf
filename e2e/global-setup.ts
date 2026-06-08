// Playwright global setup: authenticate the admin gate ONCE and persist the
// session cookie as storageState, so admin-gated specs (the calculator) reuse
// it instead of logging in per test.
//
// The login flow is a server action (src/app/admin/login/actions.ts) that
// verifies ADMIN_PIN and sets an HMAC-signed `admin_session` httpOnly cookie.
// We type the throwaway local PIN, wait for the redirect to /admin, then save
// the resulting cookie. Supabase is mocked here too so the login/admin pages
// never reach the network.

import { chromium, type FullConfig } from "@playwright/test";
import { MockDb, installSupabaseMock } from "./support/supabaseMock";
import { seed } from "./support/fixtures";
import { ADMIN_PIN, ADMIN_STORAGE_STATE } from "./constants";

async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:3100";

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });

  // Mock Supabase so the admin shell (which reads/seeds league_settings on
  // mount) renders without touching the network.
  const db = new MockDb();
  await installSupabaseMock(context, db);
  seed(db, { league_settings: [{ key: "buy_in_amount", value: "10" }], players: [], seasons: [] });

  const page = await context.newPage();

  // The webServer may still be coming up — retry the first navigation.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await page.goto("/admin/login", { waitUntil: "domcontentloaded", timeout: 5000 });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      await page.waitForTimeout(1000);
    }
  }
  if (lastErr) throw lastErr;

  // Enter the PIN and submit. The PIN field is a CONTROLLED React input; fill()
  // can land before hydration and get reset to "". Type character-by-character
  // and retry until the submit button enables (submittable = pin.length === 4),
  // which proves React picked up the value.
  const pinInput = page.locator('input[name="pin"]');
  const continueBtn = page.getByRole("button", { name: /continue/i });
  let enabled = false;
  for (let attempt = 0; attempt < 10 && !enabled; attempt++) {
    await pinInput.click();
    await pinInput.fill("");
    await pinInput.pressSequentially(ADMIN_PIN, { delay: 60 });
    try {
      await continueBtn.waitFor({ state: "attached", timeout: 2000 });
      enabled = await continueBtn.isEnabled();
    } catch {
      enabled = false;
    }
    if (!enabled) await page.waitForTimeout(500);
  }
  if (!enabled) throw new Error("global-setup: PIN submit button never enabled (hydration?).");
  await continueBtn.click({ timeout: 15000 });

  // Successful auth redirects to the admin shell. Wait for the shell URL
  // SPECIFICALLY (not /admin/login, which would mean auth failed).
  await page.waitForURL((url) => url.pathname === "/admin", { timeout: 15000 });

  const state = await context.storageState({ path: ADMIN_STORAGE_STATE });
  const hasSession = state.cookies.some((c) => c.name === "admin_session");
  if (!hasSession) {
    throw new Error("global-setup: admin_session cookie was not set after login — PIN auth failed.");
  }
  await browser.close();
}

export default globalSetup;
