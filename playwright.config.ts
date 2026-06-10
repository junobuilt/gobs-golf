import { defineConfig, devices } from "@playwright/test";
import { E2E_SERVER_ENV, ADMIN_STORAGE_STATE } from "./e2e/constants";

// E2E runs against a dedicated dev server on port 3100 (avoids clashing with a
// developer's manual `npm run dev` on 3000). reuseExistingServer is FALSE so we
// ALWAYS boot our own server with the sentinel Supabase env — guaranteeing the
// app never receives the production URL. See e2e/constants.ts for the prod-safety
// rationale.
const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // CI boots a fresh dev server per run; allow 2 retries there to absorb
  // first-request / server-warmup flake (0 locally to surface real failures).
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: ADMIN_STORAGE_STATE },
    },
  ],

  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: E2E_SERVER_ENV,
  },
});
