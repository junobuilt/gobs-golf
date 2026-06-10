// Vercel "Ignored Build Step" — gate the production deploy on the GitHub Actions
// CI `test` job (tsc + vitest, incl. the scoring golden-master / cross-surface /
// invariant suites).
//
// VERCEL SEMANTICS (important): this command's exit code controls the build —
//   exit 1  → BUILD PROCEEDS (deploy)
//   exit 0  → BUILD IS SKIPPED (no deploy)
// (Counter-intuitive: "ignored build step" exits 0 to IGNORE/skip the build.)
//
// WIRING (Jonathan, in Vercel → Project → Settings → Git):
//   • "Ignored Build Step" command:   node scripts/vercel-ignored-build-step.mjs
//   • Add a project Environment Variable GITHUB_TOKEN = a fine-grained PAT with
//     READ-ONLY access to this repo's "Checks" + "Commit statuses" (no write).
//
// The script waits (up to TIMEOUT) for the `test` check on the deploying commit
// to finish, then PROCEEDS only on success. e2e is intentionally NOT required
// (it can flake); add "e2e" to GATE_CHECKS once it's proven solid in CI.
//
// FAIL-OPEN: if the gate itself can't run (no token, API error, no commit SHA)
// it PROCEEDS rather than wedging deploys for a solo maintainer — a broken gate
// is not the same as a failing test. A genuinely RED `test` check still blocks.

const GATE_CHECKS = ["test"]; // CI job names that must be green to deploy
const TIMEOUT_MS = 10 * 60 * 1000;
const INTERVAL_MS = 15 * 1000;

const owner = process.env.VERCEL_GIT_REPO_OWNER || "junobuilt";
const repo = process.env.VERCEL_GIT_REPO_SLUG || "gobs-golf";
const sha = process.env.VERCEL_GIT_COMMIT_SHA;
const token = process.env.GITHUB_TOKEN;

const proceed = (msg) => { console.log(`[deploy-gate] BUILD — ${msg}`); process.exit(1); };
const skip = (msg) => { console.log(`[deploy-gate] SKIP — ${msg}`); process.exit(0); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!sha) proceed("no VERCEL_GIT_COMMIT_SHA — cannot gate, failing open");
if (!token) proceed("no GITHUB_TOKEN env var — cannot gate, failing open");

const url = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`;
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "gobs-deploy-gate",
};

const start = Date.now();
while (Date.now() - start < TIMEOUT_MS) {
  let runs;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) proceed(`GitHub API ${res.status} — failing open`);
    runs = (await res.json()).check_runs || [];
  } catch (err) {
    proceed(`fetch error (${err}) — failing open`);
  }

  const gated = GATE_CHECKS.map((name) => runs.find((r) => r.name === name));

  // All required checks have COMPLETED → decide.
  if (gated.every((r) => r && r.status === "completed")) {
    const failed = gated.filter((r) => r.conclusion !== "success");
    if (failed.length === 0) proceed(`CI green: ${GATE_CHECKS.join(", ")}`);
    skip(`CI not green: ${failed.map((r) => `${r.name}=${r.conclusion}`).join(", ")}`);
  }

  // Still pending (or the check hasn't been created yet) → wait.
  await sleep(INTERVAL_MS);
}

skip(`timed out after ${TIMEOUT_MS / 1000}s waiting for CI: ${GATE_CHECKS.join(", ")}`);
