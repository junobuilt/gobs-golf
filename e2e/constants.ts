// Single source of truth for the E2E harness configuration.
//
// These are THROWAWAY, NON-SECRET values used only by the local Playwright run.
// They are intentionally committed so the suite is reproducible (and CI-ready)
// without depending on a developer's gitignored .env.local.
//
// PROD SAFETY: the dev server booted by Playwright is given E2E_SUPABASE_URL
// (a sentinel host that does not exist) — never the real Supabase URL. Every
// Supabase request is then served by the in-process route mock in
// support/supabaseMock.ts. As defense-in-depth, that mock also hard-fails the
// run if any request URL ever contains PROD_PROJECT_REF. There is therefore no
// path by which an E2E test can read or write the production database.

// The live production project ref. The mock aborts + fails on any request whose
// URL contains this string. The dev server is NEVER handed this URL.
export const PROD_PROJECT_REF = "crscpwbuhvpiuxdebyxm";

// Sentinel Supabase URL handed to the dev server via webServer.env. The host is
// intentionally non-resolvable; all traffic to it is intercepted by the mock.
export const E2E_SUPABASE_URL = "https://e2e-supabase.local";
export const E2E_SUPABASE_ANON_KEY = "e2e-anon-key-not-a-real-secret";

// Local admin gate. Mirrors the throwaway values in .env.local. The dev server
// verifies the PIN against ADMIN_PIN and signs the session cookie with
// ADMIN_COOKIE_SECRET; global-setup types ADMIN_PIN into /admin/login once.
export const ADMIN_PIN = "0000";
export const ADMIN_COOKIE_SECRET = "e2e-test-cookie-secret-0123456789";

// Where global-setup persists the authenticated admin storageState.
export const ADMIN_STORAGE_STATE = "e2e/.auth/admin.json";

// Env block injected into the dev server process by playwright.config.ts.
export const E2E_SERVER_ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: E2E_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: E2E_SUPABASE_ANON_KEY,
  ADMIN_PIN,
  ADMIN_COOKIE_SECRET,
  // Quiet Sentry in the e2e dev server.
  NEXT_PUBLIC_SENTRY_DSN: "",
};
