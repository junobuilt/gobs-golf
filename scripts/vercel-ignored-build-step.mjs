// Vercel "Ignored Build Step" — gate the production deploy on the GitHub Actions
// CI `test` job (tsc + vitest, incl. the scoring golden-master / cross-surface /
// invariant suites).
//
// VERCEL SEMANTICS (important): this command's exit code controls the build —
//   exit 1  → BUILD PROCEEDS (deploy)
//   exit 0  → BUILD IS SKIPPED (no deploy)
// (Counter-intuitive: "ignored build step" exits 0 to IGNORE/skip the build.)
//
// WHY COMMIT STATUSES (not the Checks API): GitHub Actions report job results as
// *check runs*, which need the fine-grained "Checks" permission. To work with a
// token that only has "Commit statuses", the CI workflow POSTS a commit status
// (context `ci/test`, state success/failure) at the end of the `test` job, and
// this gate reads that status. So the GITHUB_TOKEN here needs only READ-ONLY
// "Commit statuses".
//
// WIRING (Jonathan, in Vercel → Project → Settings → Git):
//   • "Ignored Build Step" command:   node scripts/vercel-ignored-build-step.mjs
//   • Add a project Environment Variable GITHUB_TOKEN = a fine-grained PAT with
//     READ-ONLY "Commit statuses" on this repo (no write, no other scopes).
//
// The script waits (up to TIMEOUT) for the `ci/test` status on the deploying
// commit to reach a terminal state, then PROCEEDS only on success. e2e is
// intentionally NOT gated (it can flake); add its context to GATE_CONTEXTS once
// it's proven solid (and have the workflow post it).
//
// FAIL-OPEN: if the gate itself can't run (no token, API error, no commit SHA)
// it PROCEEDS rather than wedging deploys for a solo maintainer — a broken gate
// is not the same as a failing test. A genuinely FAILED `ci/test` status still
// blocks.

const GATE_CONTEXTS = ["ci/test"]; // commit-status contexts that must be success
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

// Combined status: { state, statuses: [{ context, state, ... }] } — one latest
// entry per context. We look only at OUR contexts (ignoring e.g. Vercel's own).
const url = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/status?per_page=100`;
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "gobs-deploy-gate",
};
const TERMINAL = new Set(["success", "failure", "error"]);

const start = Date.now();
while (Date.now() - start < TIMEOUT_MS) {
  let statuses;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) proceed(`GitHub API ${res.status} — failing open`);
    statuses = (await res.json()).statuses || [];
  } catch (err) {
    proceed(`fetch error (${err}) — failing open`);
  }

  const gated = GATE_CONTEXTS.map((ctx) => statuses.find((s) => s.context === ctx));

  // All required contexts have reached a terminal state → decide.
  if (gated.every((s) => s && TERMINAL.has(s.state))) {
    const failed = gated.filter((s) => s.state !== "success");
    if (failed.length === 0) proceed(`CI green: ${GATE_CONTEXTS.join(", ")}`);
    skip(`CI not green: ${failed.map((s) => `${s.context}=${s.state}`).join(", ")}`);
  }

  // Still pending (or the status hasn't been posted yet) → wait.
  await sleep(INTERVAL_MS);
}

skip(`timed out after ${TIMEOUT_MS / 1000}s waiting for CI: ${GATE_CONTEXTS.join(", ")}`);
