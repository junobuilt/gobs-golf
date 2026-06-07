# GOBS Status

*Auto-maintained by Claude Code at end of each session. For session handoff. Single source of truth for "what's the state right now."*

**Last updated:** 2026-06-06 (scorecard 🎲 blind-draw pseudo-rows)
**Session purpose:** Read-only scorecard now renders a 🎲 "Blind draw: {name}" pseudo-row for each round-start fill on the displayed team, so a finalized short team's moved total has a visible explanation (matching the summary). Pure render addition + one minimal data touch (the drawn player's name wasn't in the existing `blindDrawInputs`). No engine change. Closes the "consistent but not self-summable" flag from 30443bc / 7b6c043. Suite **422/422**, `tsc --noEmit` clean. Live-verified round 101 Team 1 (🎲 Ward C, headline −17 unchanged) + round 161 Team 4 (🎲 Ron L, −11).

---

## 2026-06-06 (scorecard 🎲 blind-draw pseudo-rows)

### Where we left off

**The read-only scorecard now shows WHY a short team's total moved.** After the best-N blind-draw fixes (30443bc engine + 7b6c043 scorecard headline), the scorecard headline correctly included the fill but the drawn player had no row — viewers saw a moved number with no explanation. The summary already rendered a 🎲 pseudo-row; this brings the scorecard to parity. **Pure render addition; no engine change.**

**Investigation (plan-first, AskUserQuestion — user skipped, proceeded on the two Recommended options):**
- The summary's pseudo-row is `BlindDrawPseudoPlayerSection` ([RoundResultsView.tsx:529](src/components/round/RoundResultsView.tsx)) — local/non-exported, summary-styled, depends on the results.ts `BlindDrawFill` shape + `fillScoreCopy`/`rangeCopy`. Not directly reusable; a scorecard-native card matching the roster-row layout is the right move.
- The read-only scorecard is the **same render path** as live entry (`+/−` gated on `!isLocked`); rows slot in after the `roundPlayers.map` and before the nav buttons.
- **Decision 1 (scope):** dropout fills (`holeRangeStart > 1`) are **already shown** on the scorecard — merged into the dropped player's row via `fillsByRpId`, mirroring the summary. So new pseudo-rows are for **round-start fills only** (`holeRangeStart === 1`); rendering dropout fills too would duplicate. All 5 affected prod rounds are round-start; zero dropout fills exist.
- **Decision 2 (data gap):** the drawn player's **name is not in `blindDrawInputs`** (it stores `round_players.id`, and drawn players are on other teams → not in `roundPlayers`). Minimal fix: added `players(full_name)` to the **existing** `drawnRps` join inside `refreshBlindDrawInputs` (no new query) + a new `blindDrawFillRows` render state. Name disambiguated **at render time** via `getDisplayName(..., allActivePlayers)` (fresh at render; carrying `fullName` keeps it correct even for an inactive drawn player).

**Files touched:**
- `src/app/round/[id]/scorecard/page.tsx` — new module-level `BlindDrawFillRowData` type + `BlindDrawFillRow` component (muted dashed-border card, 🎲 + "Blind draw: {name}", current-hole big number, expandable `PlayerHoleGrid` with out-of-range holes blank); new `blindDrawFillRows` state; `refreshBlindDrawInputs` enriched (name join + render rows, cleared on the no-rows path); render block after the roster map filtered to `holeRangeStart === 1`.
- `tests/components/scorecard-blinddraw-row.test.tsx` — NEW, 5 tests (FakeSupabase harness): round-start fill → one 🎲 row + disambiguated "Ward C" + expanded 18-hole grid (F9/B9 = 27); pre-finalize → none; finalized no-draws → none; dropout fill (10–18) → no duplicate pseudo-row; two round-start fills → two rows. **Negative-control verified** (disabling the render fails the 2 positive tests, the 3 absence guards still pass).

**Live verification (`next-dev`, prod data):**
- `/round/101/scorecard?team=1` — 🎲 "Blind draw: Ward C" row (Kevin I + Wayne H roster), expanded grid shows Ward's scores, **headline Team Net −17 unchanged**.
- `/round/161/scorecard?team=4` — 🎲 "Blind draw: Ron L", headline −11. No console errors.

### Today's commits

- (this session) — feat(scorecard): render 🎲 blind-draw fill rows on the read-only scorecard

### Tomorrow's priority

1. **H3.x — `seasons` table + migration** — top remaining feature priority.
2. Carry-over: live admin smoke test (D.2); historical backfill decision for the 5 corrected best-N rounds; retract the superseded "Played With v2" DB-layer disambiguation locked bullet (flagged in the prior session).

### Considered but not changed (confession)

- **Dropout-fill pseudo-rows** — deliberately excluded (Decision 1): dropout fills are already shown via the existing `fillsByRpId` merge into the dropped player's row. Adding pseudo-rows for them would duplicate. No dropout fills exist in current data; if uniform pseudo-rows are ever wanted, the merge would need removing in the same change.
- **Per-hole fill-contribution highlight** — not implemented (out of scope per the issue): `PlayerHoleGrid` has no per-cell "contributing" highlight and roster rows don't either (contribution is shown at card level via Ball 1/Ball 2). The 🎲 grid renders the drawn scores like any roster grid.
- **The one data touch** — `players(full_name)` added to an existing join + a render-state array; unavoidable since the name isn't otherwise reachable from `blindDrawInputs`. No new query, no engine change.
- **Comment-placement glitch** at `scorecard/page.tsx` ~line 77 (the Phase D.2 chip comment now sits above `disambiguatedName` rather than `isHistoricalAdd`, from the prior session's edit) — left as-is to avoid unrelated churn.

---

## 2026-06-06 (display-name disambiguation — full rollout)

### Where we left off

**The naming convention now applies on every surface that renders player names.** Closes the rollout decision parked in this morning's Played With session (its Tomorrow-priority #1). Convention is unchanged and locked: first name + the *minimum* last-name suffix needed to disambiguate among **all active players**, always (even with no collision today — "Bill Carlson" → "Bill C"); derived from `full_name` only, `display_name` nicknames intentionally ignored.

**Approved decisions (plan-first, AskUserQuestion before coding):**
- **Option A** for the leaderboard/summary path — compute names in `results.ts` (the shared data layer) rather than threading raw `full_name` + roster into `RoundResultsView`. Smallest diff; RoundResultsView + both pages untouched. No DB/query-semantics change (the file already formatted names).
- Fold in the **PlayedWith mobile list** (was left raw this morning).
- Include `JoinTeamConfirmModal` + `MixedTeamsErrorModal` (found outside the original audit list).
- **Skip** the Players admin tab and the players directory page — full name is the point there.
- `display_name` override everywhere applied surfaces (no nicknames in the data → no manual-override tier needed).

**Cross-cutting design note:** the universe for `getDisplayName` must be the *full active roster* on every surface, else the same player's suffix length would differ between screens (e.g. "Bill Carl" on the leaderboard vs "Bill Ca" in a picker subset). Surfaces that only loaded a per-round subset (History, scorecard, results.ts) gained a one-off active-player fetch. New helper `buildDisplayNameMap(allPlayers)` added for convenience (not yet widely used — most sites call `getDisplayName` directly).

**Files touched:**
- `src/lib/players/displayName.ts` — added `buildDisplayNameMap` convenience (id → name Map). Helper itself unchanged.
- `src/lib/round/results.ts` — **Option A.** New active-roster fetch + `nameFor(playerId, fullName)`; applied to `playerLookup.displayName`, `rosterDisplay`, per-player `displayName`, and blind-draw `drawnPlayerName`. Drives /leaderboard + /round/[id]/summary + RoundResultsView with zero changes to those files.
- `src/app/admin/tabs/PlayedWith.tsx` — folded the mobile pairing list onto `shortName(full_name)` (desktop heatmap already shipped this morning).
- `src/app/admin/tabs/History.tsx` — added active-roster fetch (parallel with rounds) + `player_id` to the round_players select; team rosters now disambiguated.
- `src/app/page.tsx` (homepage) — `player_id` added to the team-card round_players select; team cards, create/join toasts, and `playerNamesToAdd` disambiguated; `allActivePlayers` passed to the three team-formation children.
- `src/app/season/page.tsx` — active-roster fetch + `nameFor`; leaderboard rows disambiguated.
- `src/app/player/[id]/page.tsx` — `nameOf` switched to `getDisplayName` against the active roster (partner + never-played lists). **Page title still shows the full name.**
- `src/app/round/[id]/scorecard/page.tsx` — `RoundPlayer` gains raw `full_name`; new `allActivePlayers` state loaded on mount; `display_name` is now the disambiguated short name (computed at both mapping sites via `disambiguatedName()`), so all ~15 downstream reads update automatically; ManageTeamSheet gets raw `full_name` + `allActivePlayers`.
- `src/components/teamFormation/{PlayerPickerSheet,ManageTeamSheet,JoinTeamConfirmModal,MixedTeamsErrorModal}.tsx` — each takes an optional `allActivePlayers` prop and applies `getDisplayName` against it (falls back to its locally-known players when omitted, so existing call sites/tests stay valid).
- `tests/components/teamFormation/PlayerPickerSheet.test.tsx` — updated expected names to disambiguated forms ("Alice" → "Alice A"); NEW two-Waynes collision test.
- `tests/lib/round/results-displayName.test.ts` — NEW. Drives `loadRoundResults` through the FakeSupabase harness with two Waynes + a third active player not in the round; asserts `rosterDisplay` = "Wayne H · Wayne V" and per-player names. Covers leaderboard + summary (shared path). The third player proves the universe is the full active roster.

**Live verification (`next-dev`, real prod data):**
- `/season` — shows **"Wayne V"** and **"Wayne H"**.
- `/player/45` (Wayne Hashimoto) — title stays **"Wayne Hashimoto"** (full); partner/never lists show disambiguated names incl. real collisions **"Dan G" / "Dan S"**, "Don D", "Bill T".
- No console errors. (Homepage/leaderboard had no round today → no team cards to inspect live; covered by the results.ts + PlayerPickerSheet tests. Admin History is PIN-gated locally → covered by tsc + suite.)

### Today's commits

- (this session) — feat(players): roll out display-name disambiguation to all name surfaces

### Tomorrow's priority

1. **H3.x — `seasons` table + migration** — top remaining feature priority.
2. **Scorecard fill rendering** (deferred display enhancement, from the morning best-N session).
3. Carry-over: live admin smoke test (D.2); historical backfill decision for the 5 corrected best-N rounds.

### Considered but not changed (confession)

- **Players admin tab + players directory page** — deliberately skipped (approved): full name is the editing/identity surface there.
- **Scorecard `player_name` in the write-queue payload + stale-failure dialog** — now uses the disambiguated `display_name` (it reads `rp.display_name`); acceptable/better, not a behavior regression.
- **Two active-player fetches on the scorecard** — the mount fetch (`allActivePlayers`, for row disambiguation) and the lazy `manageTeamActivePlayers` fetch (for the add flow) both hit `players`. Left as-is to keep the diff narrow and avoid touching the working Manage Team flow; could be unified later.
- **`buildDisplayNameMap`** added but most sites still call `getDisplayName` per-player — fine at 50 players (~2500 comparisons, microseconds); no caching needed per scope.
- **`results.ts:359-382` drawn-player duplication**, mixed-tee par approximation — untouched carry-over, out of scope.

---

## 2026-06-06 (best-N blind-draw — scorecard headline total)

### Where we left off

**Scorecard headline now consistent with leaderboard/summary.** Third best-N blind-draw fix of the day: 30443bc fixed the engine + the `loadRoundResults`-backed surfaces (summary, leaderboard, RoundResultsView), but the scorecard renders its headline through its own `buildRoundInput` → `computeRoundResult` call (line ~820), which omitted `blindDraws`. So a finalized short team's scorecard total stayed roster-only and disagreed with every other surface. This session plumbs the fill data into that one call. **Engine and display layer untouched — pure call-site + data-loading change.**

**Investigation (plan-first, approved before coding):**
- All headline/aggregate numbers (`getTeamTotal`, `getTeamParTotal`, F9/B9 via `getTeamNetDeltaForHoles`, `holesWithTeamScores`) funnel through `buildRoundInput`. One omission there is the whole bug. `computeHoleFor` (per-hole Ball pills / dots) deliberately left roster-only — display layer, out of scope.
- `roundPlayers`/`scores`/`holesByTee` are scoped to the **displayed team** (`?team=N`), so the drawn player's row/scores/tee-holes aren't loaded — must be fetched separately (mirrors `loadRoundResults`).
- `fillsByRpId` (the existing dropout-grid state) is **not reusable**: it loads dropout fills only (`hole_range_start > 1`), excludes round-start fills, and carries no CH/tee-holes. All 5 affected rounds are round-start fills.
- blind_draws only exist post-finalize → loading is a no-op pre-finalize; no early-return skips it.

**Files touched:**
- `src/app/round/[id]/scorecard/page.tsx` — import `BlindDrawInput`; new `blindDrawInputs` state; new self-contained `refreshBlindDrawInputs()` (re-reads team filter, scoring basis, and the drawn player's `round_players`/`scores`/`holes` from the DB — independent of render-state to avoid mount-time staleness; loads ALL fills for the team incl. round-start); called at the same 3 sites as `refreshBlindDrawFills` (mount + 2 post-finalize branches); `buildRoundInput` now passes `blindDraws: blindDrawInputs`.
- `tests/components/scorecard-blinddraw-total.test.tsx` — NEW, 2 tests via the FakeSupabase harness. Finalized single-player team + round-start fill → headline −18 (negative-control verified: with the call-site line removed the test fails, headline stays +18); pre-finalize with no blind_draws rows → headline unchanged at +18 (no-op).

**Accepted trade-offs (per approval):**
- Scorecard read-only view is now **consistent but not self-summable** for round-start fills: the headline includes the fill, but the drawn player is not rendered as a row on the scorecard (only on summary/RoundResultsView). Adding scorecard fill rendering is a deferred display enhancement.
- Mixed-tee par approximation deferred (single-tee data today).

**Live verification:** `next-dev` → `/round/101/scorecard?team=1` headline reads `Team Net −17` (F9 −8 · B9 −9), matching the leaderboard/summary. Old value was −11.

### Today's commits

- (this session) — fix(scorecard): include blind-draw fills in headline team total

### Tomorrow's priority

1. **H3.x — `seasons` table + migration** — top remaining feature priority.
2. **Scorecard fill rendering** (deferred display enhancement) — render round-start fills as a 🎲 row on the scorecard so the headline is self-summable, matching RoundResultsView's pseudo-player rows.
3. Carry-over: Played With convention rollout decision; live admin smoke test (D.2); historical backfill decision for the 5 corrected best-N rounds.

### Considered but not changed (confession)

- **`computeHoleFor` / per-hole Ball-1/Ball-2 pills** — left roster-only (display layer, out of scope). Means the per-hole BALL selection shown on the scorecard doesn't reflect the fill, consistent with how summary/RoundResultsView render the fill as a separate 🎲 element.
- **No-team-filter case** (`buildRoundInput` over all teams when `?team=` absent) — pre-existing behavior; `refreshBlindDrawInputs` only filters fills by team when `?team=N` is present. Not a real production path (scorecard links always carry `?team=N`); not addressed.
- Mixed-tee par approximation; dropout-fill scorecard scenario (no current data); `results.ts:359-382` drawn-player duplication — all carry-over, out of scope.

---

## 2026-06-06 (Played With — display-name disambiguation)

### Where we left off

**Display-name disambiguation shipped for the Played With heatmap.** New pure helper `getDisplayName(player, allPlayers, { activeOnly = true })` returns first name + the *minimum* prefix of the last name needed to tell the player apart from every same-first-name peer in the roster. Convention: "Bill Carlson" alone → "Bill C"; two Waynes → "Wayne H" / "Wayne V"; "Norm Carstairs" + "Norm Carlson" → "Norm Cars" / "Norm Carl"; single-word name → as-is; identical full names → not handled (out of concern, per spec). Recomputes on every render from the current roster — no DB storage.

**Files touched:**
- `src/lib/players/displayName.ts` — NEW. Pure function, no side effects. `PlayerLike = { id, full_name, is_active? }`. Splits first token / remainder, finds same-first-name peers (case-insensitive, excludes self by id, active-only by default), grows the last-name prefix to the first non-colliding length (capped at full last name). Handles single-word names, hyphens, apostrophes via plain string-prefix slicing; preserves original casing.
- `src/app/admin/tabs/PlayedWith.tsx` — import helper; build a `full_name → getDisplayName` Map once per render; use it for desktop heatmap **column headers** (was `name.split(" ")[0]` — the actual first-name-only bug) and **row labels** (was full "First Last"). Matrix keying / `getCount` stay on `full_name` — display only. Mobile list left unchanged.
- `tests/lib/players/displayName.test.ts` — NEW, 10 tests: the 4 convention cases, realistic GOBS roster incl. both Waynes, roster-growth (one-char grow to "Bill Ca"/"Bill Co"; true-minimal "Bill Car"/"Bill Cal"), active-only vs activeOnly:false, apostrophe/hyphen cases. Negative-control-friendly fixtures.

### Today's commits

- (this session) — feat(admin): disambiguate player names on Played With heatmap

### Tomorrow's priority

1. **Decide whether to roll the convention out to other surfaces** (see confession audit) — RoundSetup, Players, History, leaderboard rosters, round summary, scorecard, player profile. Deliberately left for a separate decision.
2. **H3.x — `seasons` table + migration** — top remaining feature priority.
3. Carry-over: best-N blind-draw scorecard headline total (2026-06-06 morning confession); live admin smoke test (D.2).

### Considered but not changed (confession)

- **Spec example imprecision flagged, not silently honored:** the issue's roster-growth example said "Bill C" → "Bill Ca" *when Bill Calderson joins*. "Carlson" and "Calderson" share "Ca", so "Bill Ca" would NOT disambiguate them — the correct minimal result is "Bill Car" / "Bill Cal". The helper implements true-minimal disambiguation; the test asserts the correct "Car"/"Cal" and separately demonstrates the one-char "Bill Ca"/"Bill Co" growth with a joiner (Cooper) that genuinely produces it.
- **Mobile Played With view** (`PlayedWith.tsx` `isMobile` branch) — left on DB `display_name || full_name`. It already shows full unambiguous names with room to spare and is not first-name-collapsed, so the bug doesn't apply. Touching it would mean choosing between the new helper and the DB column — out of scope (spec: don't change `players.display_name` behavior).
- **STEP 4 audit — other player-name surfaces, NOT changed (separate rollout decision):**
  - `admin/tabs/RoundSetup.tsx`, `admin/tabs/Players.tsx`, `admin/tabs/History.tsx` — render `full_name` / `display_name`.
  - `app/page.tsx` (homepage team rosters), `app/season/page.tsx` / leaderboard rosters.
  - `round/[id]/scorecard/page.tsx` (Manage Team / score entry), `round/[id]/summary` via `loadRoundResults` → `results.ts` (`display_name || full_name || "?"`).
  - `player/[id]/page.tsx` and `players/page.tsx` (profiles / directory).
  - Grep confirms **only** PlayedWith used the first-name-collapsing `split(" ")[0]` pattern; all others show full or DB names, so none are *broken* — rollout is a consistency choice, not a fix.

---

## 2026-06-06 (best-N blind-draw scoring — engine fix)

### Where we left off

**Best-N blind-draw scoring shipped.** Mirrors the 2026-05-26 Stableford fix, but the mechanism differs by necessity: Stableford adds drawn-player points to a separate `blindDrawTotal` accumulator (all scores count); best-N instead **injects the fill into the per-hole selection pool** so it can win or lose a "best of" spot. On override ("all scores count") holes the fill counts unconditionally — including over par (Dad confirmed: fills are full team members both ways).

**Step 1 verification (Supabase MCP, approved before coding):**
- 5 affected finalized best-N rounds with blind draws: **101** (best_ball, ovr [9,18]), **118** (best_ball, ovr [6,11]), **141** (2_ball), **147** (best_ball, ovr [12]), **161** (2_ball, ovr [9,10]). All full-18 round-start fills; all players (team + drawn) on tee 4 → uniform stroke-index allocation.
- Current (displayed) vs corrected totals and **placing impact**:
  - **101**: −11 → −17. **Round winner flips: Team 1 overtakes Team 3.**
  - 118: −4 → −3 (**worse by +1** — fill's over-par scores on override holes [6,11] count). Team 6 drops tied-4th → 5th.
  - 141: +12 → −1. Team 3 last → tied-2nd.
  - 147: +8 → +1. Same rank (still 7th); total corrected by 7.
  - 161: 0 → −11. Team 4 last → 4th.
- No payouts calculated for any of these → no dollar impact, league-placing/record impact only. **No deploy gating** (Dad's call) — corrections surface live on next deploy; Dad will communicate the 5 round changes separately.

**Files touched:**
- `src/lib/scoring/types.ts` — new `BestNFill` type; new optional `HoleInput.fills`. Updated stale `BlindDrawInput` doc (now consumed by both paths).
- `src/lib/scoring/engine.ts` — `computeBestNHole` builds a combined pool (roster `perPlayer` + fill results), runs both the override branch and best-N selection over it; selected fills land in `teamScore` + `contributingPlayerIds` (scales `teamParAtScored`) but stay out of the returned `perPlayer` (roster-only display invariant). New `resolveBestNFills` helper resolves per-hole fills using the **drawn player's own tee** stroke-index/par. Round loop injects fills for best-N only; Stableford path unchanged. Stale "best-N ignored / TODO" comment block rewritten.
- `src/lib/round/results.ts` — comment-only update (best-N now uses the pool; `total = rawTeamScore + blindDrawTotal − teamPar` formula unchanged — best-N keeps `blindDrawTotal = 0`, no double-count).
- `tests/lib/scoring/engine-bestn-blinddraw.test.ts` — NEW, 6 tests, each negative-control seeded (fail without the fix): best_ball 1-player+fill, 2_ball 3-player+fill, 3_ball 2-player+fill, mid-round dropout (1 active + dropout thru 9 + fill 10-18), override holes [9,18], and a drawn-player-own-tee net check.
- `tests/snapshots/verify-bestn-blinddraw.mjs` — NEW belt-and-suspenders script: runs the real engine over all 5 rounds before/after and asserts the deltas match the SQL replication. **All 5 ✓.**

**Audit-pass (CLAUDE.md principle #1):**
- `result.teamScore` / `contributingPlayerIds` readers: `results.ts` (rawTeamScore, legTotal par-scaling via `.length`), summary/leaderboard/RoundResultsView through `loadRoundResults`. All pick up the fix.
- `teamParAtScored` (engine.ts) scales by `contributingPlayerIds.length` — fills now in that list, so par reference scales correctly (uses the team's hole par; uniform-tee in all current data).

### Today's commits

- (this session) — feat(scoring): include blind-draw fills in best-N team totals

### Tomorrow's priority

1. **Scorecard headline total for short teams** — see confession; decide whether the live scorecard's own-team total should reflect round-start fills (currently roster-only by design; authoritative totals live on summary/leaderboard).
2. **H3.x — `seasons` table + migration** — top remaining feature priority.
3. **Historical recalculation/backfill** of the 5 corrected rounds — parked as a separate decision (was explicitly out of scope this session).

### Considered but not changed (confession)

- **Scorecard headline team total (`getTeamTotal` / `buildRoundInput` in `scorecard/page.tsx`)** does **not** pass `blindDraws`, so a finalized short team's total on the *scorecard* surface stays roster-only (round-start fills render as pseudo-player rows on the *summary*, per existing D.1 design; the scorecard's `refreshBlindDrawFills` deliberately skips `hole_range_start = 1` fills). The authoritative placing surfaces (summary / leaderboard / RoundResultsView via `loadRoundResults`) ARE corrected. Flagged not fixed — it's display-layer (explicitly out of scope) and touching the live-entry total risks pre-finalize behavior. Same gap would affect a *dropout* best-N fill's scorecard headline (none exist in current data). Decision for next session.
- **Historical backfill** of the 5 rounds — out of scope per spec; totals recompute live on read, so no DB write is strictly needed, but the round-101 winner change is a league-record event worth a deliberate sign-off.
- **`results.ts:359-382` `drawnPlayerNetValue` block** — still duplicates engine drawn-player aggregation; untouched (carry-over, out of scope).
- **Mixed-tee par reference** — `teamParAtScored` and `legTotal` use the team's hole par for fill contributors, not the drawn player's; exact for all current data (everyone on tee 4) but a latent approximation if a future fill comes from a different tee. Noted, not addressed.

---

## 2026-05-30 (A9 follow-up — tie-prompt / manual ball-override removed)

### Where we left off

**Best-N tie-prompt + manual ball-override fully removed from the live scorecard.** In 2-Ball / 3-Ball / Best Ball the scorecard always auto-picks the N best net balls per hole and resolves ties silently and deterministically (best-N by roster order). The read-only **BALL 1 / BALL 2** pills remain (informational). The amber "Tied" affordance, the tied-for-Ball banner, and the tap-to-override footer are gone.

**Investigation (plan-first, approved before coding):**
- `countingOverrides` was pure ephemeral React `useState` — never written to or read from the DB. It fed the engine live via `manualContributors` only while mounted.
- `FormatConfig` has **no** manual-contributor key. Scores persist raw strokes only; team totals are always recomputed.
- Prod check (Supabase MCP): `format_config` keys across **all** rounds are only `basis / best_n / override_holes / scoring_basis / submitted_teams`. **Zero** rounds (finalized or not) have a manual ball override on record — there is no schema location for one. → ephemeral-only end state: UI-only removal, **no migration, no finalized-round impact**.

**Files touched:**
- `src/app/round/[id]/scorecard/page.tsx` — deleted `countingOverrides` state, `getTieInfo`, `toggleOverride`, the tie banner, the interactive "Tied" pill, the override footer, the card tap-to-override `onClick` (cursor → default), the amber hole-dot override highlight, and the `manualContributors` plumbing in `computeHoleFor` / `buildRoundInput`. Kept `getCountingPlayerIds` + BALL 1/2 pills.
- `src/lib/scoring/types.ts` — comment above `HoleInput.manualContributors` marking it a retained extension point (no production caller as of 2026-05-30; exercised only by `engine-overrides.test.ts`). **Param not removed.**
- `tests/components/scorecard-tie-no-override.test.tsx` — NEW. On a 3-way net tie in a 2-Ball round: banner + footer copy absent, "Tied" pill absent, BALL 1 / BALL 2 still render.
- `tests/lib/scoring/engine-bestn.test.ts` — 3 new deterministic tie-resolution cases (three-way exact tie → first N by input order; tie for last spot → lower input index; 3-Ball three-way tie still excludes the worst ball).

**What NOT changed (confession):**
- **Engine `manualContributors` param** — retained per the approved plan (ephemeral end-state = no engine change). It's now dead-but-tested API. Optional Low-sev tech-debt: remove it from the engine + `engine-overrides.test.ts:35` if a future cleanup wants it. Not required.
- **B3.1 `override_holes`** (admin "all scores count") — untouched; `engine-overrides.test.ts` unchanged and green.
- Stableford-family formats, the best-ball selection math, RoundResultsView / summary / leaderboard (verified they don't surface the banner/footer).

**Verification:** `tsc --noEmit` clean. Full suite **397/397** green (includes new tests; note the prior 392/392 D.2 baseline grew). Verified via the new component test rather than live preview — reproducing a live 3-way net tie needs specific seeded data; the component test exercises the real component deterministically with the fake-supabase harness.

### Today's commits

- (this session) — feat(scorecard): remove tie-prompt / manual ball-override in best-N (A9)

### Tomorrow's priority

1. **Live admin smoke test** — still the carry-over from D.2: end-to-end reopen of a real finalized round, add player, edit HI, finalize.
2. **H3.x — `seasons` table + migration** — top remaining feature priority.
3. **Best-N blind-draw scoring** — engine `// TODO` still open.

### Considered but not changed (confession)

- **Removing `manualContributors` from the engine** — deliberately left per approved plan; logged above as optional Low-sev TD.
- Carry-over from prior sessions (unchanged this session): `results.ts:359-382` drawn-player duplication; best-N blind-draw scoring gap; `tests/app/player-profile-ordering.test.tsx` `.gt` mock gap.

---

## 2026-05-27 (Phase D.2 ship)

### Where we left off

**Phase D.2 fully shipped.** Admin can now reopen any finalized round from `/admin` → Round Setup → Edit Round, edit HI per-player on the scorecard, and re-finalize via the banner's "Finalize Round" button. Engine-layer math (CH recompute, blind-draw preservation, snapshot writes) covered by 27 new tests including negative controls per CLAUDE.md engineering principle #3.

**Files touched:**
- `supabase/migrations/012_phase_d2_rounds_was_finalized.sql` — new column + trigger + backfill UPDATE.
- `supabase/migrations/013_phase_d2_round_players_hi_verified.sql` — new nullable timestamp column.
- `src/lib/round/reopenRound.ts` — new helper. Read-modify-write on `format_config`; clears `submitted_teams=[]`, flips `is_complete=false`. Preserves blind_draws, scores, was_finalized.
- `src/lib/round/finalizeRoundAdmin.ts` — new helper. Single `UPDATE rounds SET is_complete=true`; latch trigger handles was_finalized.
- `src/app/admin/tabs/RoundSetup.tsx` — Edit Round button + reopen DangerModal (copy varies by blind_draws count); `loadRoundForDate` now selects `was_finalized` and counts `blind_draws`; scorecard links append `?admin=1&edit=1` when reopened.
- `src/components/round/EditModeBanner.tsx` — conditional Finalize vs Done based on `is_complete=false AND was_finalized=true` (reopened state). All other combos show Done.
- `src/app/round/[id]/scorecard/page.tsx` — `RoundPlayer` gains `created_at` + `hi_verified_at`. SELECT query updated. New `isHistoricalAdd` helper, Edit HI modal state, `openEditHiModal` / `saveEditHi` handlers. UI: Edit HI link next to HI display, HI verification chip next to player name, modal with Save + "Verify (no change)" buttons.
- `src/components/round/RoundResultsView.tsx` — removed D1.11 "Edit Round Scores" button + 4 unused imports.
- `tests/components/admin-edit-flow.test.tsx` — DELETED (covered the removed summary-page button).
- `tests/components/edit-mode-banner.test.tsx` — rewritten for the 3 conditional banner states + 3 regression tests for the in-browser-caught bug (Finalize was rendering on D1.11 edit-in-place sessions).
- `tests/lib/round/reopenRound.test.ts` — 8 unit tests including negative-control for `submitted_teams` clearing.
- `tests/lib/round/finalizeRoundAdmin.test.ts` — 4 unit tests.
- `tests/components/edit-hi-flow.test.tsx` — 8 tests: modal open, chip predicate, CH recompute (negative-control fixture seeds stale CH=99), Save + Verify, scope isolation (no `players` writes, no other-row writes).

**Preflight findings (CC spec required before code):**
1. ✅ LT1 self-heal at `scorecard/page.tsx:263` exists and is gated on `!roundIsComplete` (H.2.5.4) — but the useEffect dep is `[roundId]` only, so it does NOT re-fire on snapshot changes. Edit HI save path computes CH explicitly via `computeCourseHandicap`. Documented in `saveEditHi`.
2. ✅ `rounds.format_config` is `jsonb NOT NULL` with default shell. `submitted_teams` is an array of integers (team numbers), only present after first submit. All readers tolerate missing/empty via `Array.isArray(cfg?.submitted_teams) ? ... : []`.
3. ✅ Migration numbers 010 + 011 taken; D.2 uses 012 + 013.

**Audit-pass (CLAUDE.md principle #1, "writes must audit all reads"):**
- `was_finalized` readers: EditModeBanner (showFinalize gate), RoundSetup (link construction). Both new this session; correct under the trigger semantics.
- `hi_verified_at` readers: scorecard chip predicate (`isHistoricalAdd && verified == null`). Only render path; no other consumer yet.
- `format_config.submitted_teams` writers: scorecard `submitTeam` (read-modify-write append), reopenRound (read-modify-write clear). Race window documented at both sites; matches league usage (in-person, essentially serial).
- `round_players.handicap_index_snapshot` writers: applyTempHandicap (existing, pre-round HI entry), saveEditHi (new), Manage Team add path (insert with snapshot from `players.handicap_index`), Players.tsx admin HI edit cascade. All four paths consistent.
- `round_players.course_handicap` writers: applyTempHandicap, updatePlayerTee, LT1 self-heal (fire-and-forget at scorecard mount), saveEditHi (new). All four agree on `computeCourseHandicap(snapshot, slope, CR, par)` formula.

**DB changes applied to prod (via Supabase MCP):**
- Migration 012 applied. Backfill verified: 16 finalized rounds → 16 `was_finalized=true`. Total rounds = 16; never_finalized = 0 (all current prod rounds are finalized).
- Migration 013 applied. Verified: 198 round_player rows, all with `hi_verified_at = NULL` as expected.

**Browser verification (round 156, finalized 2026-05-27):**
- `/round/156/summary` — confirmed Edit Round Scores button is gone (D1.11 entry point removed).
- `/round/156/scorecard?team=1&admin=1&edit=1` — confirmed EditModeBanner shows **Done** (round is `is_complete=true AND was_finalized=true` → D1.11 admin edit-in-place, not reopened); 3 Edit HI links rendered (one per player); 0 verification chips (correct — all rows created on round day, predicate fails).
- Edit HI modal: opens on click, prefilled with current snapshot (20.5 for Rick C), Save and "Verify (no change)" buttons both rendered.

### Today's commits

- (this session) — feat(admin): Phase D.2 — Admin Edit Round button, HI override, Finalize/Done banner conditional

### Tomorrow's priority

1. **Live admin smoke test** — Jonathan (or Dad) does an end-to-end reopen of a real finalized round, adds a player to a new team, edits their HI, verifies CH recomputes correctly, finalizes the round. The flow has 392/392 test coverage but a hands-on click-through is worth doing once before the next live round.
2. **H3.x — `seasons` table + migration** — top remaining feature priority per 2026-05-24's lock, still gated on this manual smoke.
3. **Best-N blind-draw scoring** — engine `// TODO` from 2026-05-26 still open. Worth scoping when the next best-N round needs to include drawn players.

### Considered but not changed (confession)

- **`results.ts:359-382` `drawnPlayerNetValue` block** — still duplicating engine drawn-player aggregation per the 2026-05-26 note. Out of scope this session.
- **Admin tab end-to-end browser verification** — skipped because the local dev `.env.local` has no `ADMIN_PIN` set, so the PIN gate redirects every `/admin` hit to login. The Edit Round button is covered by 8 unit tests (reopenRound) + 4 (finalizeRoundAdmin) + 10 (EditModeBanner conditional). Worth a manual click-through next time `.env.local` is configured.
- **TD20 closure** — `withAdminFlags` is now used by RoundSetup's per-team scorecard link construction (the conditional `?admin=1&edit=1` append for reopened rounds), but I implemented it as an inline ternary rather than calling the helper, to keep the diff narrow. Worth a 1-line refactor next session if `withAdminFlags` would simplify it.
- **Best-N blind-draw scoring gap** — same engine `// TODO` from 2026-05-26; explicitly out of scope for D.2.

### Independent issues surfaced during D.2, not fixed

- **`tests/app/player-profile-ordering.test.tsx`** still logs the `.gt is not a function` mock gap from 2026-05-24. Not touched this session.
- **`tests/components/admin-edit-scorecard.test.tsx`** test at line 167 renders `<EditModeBanner />` directly without seeding `fakeRef.current` — relies on test-order side effect from prior tests in the file. Brittle; works today, would break if vitest changed isolation defaults. Worth tightening but not blocking.

---

## 2026-05-26 (evening)

### Where we left off

**Fix shipped.** Engine API change is additive (new optional input field; two new always-present output fields with `0` / `{}` defaults). Stableford team totals on `/round/[id]/summary` and the live leaderboard now include drawn-player points. Round 155 expected display after reload: Team 1 = 139, Team 2 = 129 (was 105 vs 129). No DB backfill needed — team totals are computed at read time.

**Files touched:**
- `src/lib/scoring/types.ts` — new `BlindDrawInput` type, optional `RoundInput.blindDraws`, new `RoundResult.blindDrawTotal` + `RoundResult.blindDrawPerHole`.
- `src/lib/scoring/engine.ts` — `computeRoundResult` aggregates drawn-player Stableford points (resolves the format-correct point table once at the round level; `mergePointTable(GOBS_STABLEFORD_POINTS, formatConfig.point_values)` for GOBS).
- `src/lib/round/results.ts` — builds per-team `BlindDrawInput[]` from the existing `blindDrawRows` + `playerLookup` + `scoresByRpId` + `holesByTee`. `total = rawTeamScore + blindDrawTotal − teamPar`. `legTotal()` adds `blindDrawPerHole[h]` for each hole in F9 / B9.
- `tests/lib/scoring/engine-stableford.test.ts` — three new tests + tightened existing baseline (now asserts `blindDrawTotal` defaults to 0 / `{}`).

**Audit-pass (CLAUDE.md principle #1, "writes must audit all reads"):**
- `result.teamScore` readers: `engine.ts` internal; `scorecard/page.tsx` (in-round, no blind draws yet — unchanged); `results.ts:247` (rawTeamScore). All correct under the new semantic ("team's own players only").
- `result.perHole[h].teamScore` readers: `results.ts` `legTotal()` (updated to also add `blindDrawPerHole[h]`); `scorecard/page.tsx:750,810` (in-round, unchanged). Per-hole invariant preserved.
- `team.total` readers: `rank.ts` (sort), `RoundResultsView` (display). Both pick up the fix through the new headline formula.
- `team.f9Total` / `team.b9Total` readers: `RoundResultsView`. Picks up fix via `legTotal()` change.
- `BlindDrawFill.drawnPlayerNetValue` readers: `RoundResultsView` caption. Unchanged (per-fill aggregate computed independently from per-team accumulator; both paths produce consistent numbers because both use the drawn player's own CH + tee SI).

### Today's commits

- (this session) — fix(scoring): include blind-draw points in Stableford team totals

### Tomorrow's priority

1. **Manual verification of round 155** — reload `/round/155/summary`; confirm Team 1 = 139, Team 2 = 129.
2. **Resume previous H3.x track** — `seasons` table + migration is still the top remaining feature priority per 2026-05-24's plan.
3. **Best-N blind-draw scoring** — same engine path likely has the same gap for 2-Ball / 3-Ball / Best Ball formats; engine currently silently ignores `blindDraws` for them with a `// TODO` marker. Worth scoping next time best-N rounds need to include drawn players.

### Considered but not changed (confession)

- **`results.ts:359-382` `drawnPlayerNetValue` block** — duplicates the engine's drawn-player aggregation for the per-fill caption. The new `blindDrawPerHole` lets us derive per-fill totals too, so this could be folded into the engine output. Left as-is to keep this commit narrow.
- **Best-N blind-draw scoring** — same bug shape almost certainly affects 2-Ball / 3-Ball / Best Ball; spec explicitly deferred.
- **`tee_id` mixed-tee handling** in `results.ts`'s `firstTeeId` lookup — pre-existing; not touching.

---

## 2026-05-24 (evening)

### Where we left off

**Part 1 — Admin PIN gate (D1) shipped.** `/admin` and `/admin/*` now gated behind a 4-digit PIN. Middleware on the Edge runtime (`src/middleware.ts`) checks an HMAC-SHA256-signed `admin_session` cookie (90-day expiry). Login page at `/admin/login` uses a server action (`src/app/admin/login/actions.ts`) that timing-safely compares the submitted PIN against `process.env.ADMIN_PIN`. No rate limiting per spec. Homepage Admin button unchanged. 7/7 unit tests passing on the sign/verify helpers (round-trip, tampered, expired, malformed). `tsc --noEmit` clean.

**Crucial pre-deploy step still on Jonathan:** Add `ADMIN_PIN` and `ADMIN_COOKIE_SECRET` to Vercel Production + Preview + Development environments. Without them, the deployed gate will reject every PIN with "Incorrect PIN" and the Edge runtime will log `ADMIN_PIN is not set` / `ADMIN_COOKIE_SECRET is not set` per request. Local `.env.local` is already set.

**Part 2 — Jeff Irvin White tees (DB-only, no commit).** Mental model in the spec was imprecise: there is no Wayne hardcode in code. Tee preference is stored as a per-row column `players.preferred_tee_id`. Discovered TWO Waynes — only Wayne Vincent (id=55) had `preferred_tee_id = 2` set; Wayne Hashimoto (id=45) is NULL (uses league default). Updated Jeff Irvin (id=22) `preferred_tee_id` from NULL → 2 (White) via Supabase MCP. Verified with RETURNING in same round-trip.

### Today's commits

- `8234b9e` — docs: 2026-05-24 evening doc reconciliation — D1 closed, H1 withdrawn, Phase E v2 + H3.x precursor (Part 3)
- `828bbf1` — Add admin PIN gate (D1) (Part 1)
- `d506460` — feat(player-profile): Phase E1 v1 — Played With section with four buckets (morning)
- `f04d79a` — chore: update STATUS.md for 2026-05-24 Phase E1 v1 session (morning)

### DB changes (today, not in git history)

- `UPDATE players SET preferred_tee_id = 2 WHERE id = 22` — Jeff Irvin → White tees, matches Wayne Vincent's pattern. No migration file; per-row data update, not a schema change.

### Tomorrow's priority

Per the new active-priority order locked in ROADMAP.md today (TD22 → H3.x → Phase E v2 → E2/E3/E4 → H.2 → F.1 → G):

1. **Manually add Vercel env vars** before any deploy: `ADMIN_PIN`, `ADMIN_COOKIE_SECRET` to Production + Preview (Development blocked for sensitive vars — expected; local `.env.local` covers dev). Without these the deployed /admin path is broken (rejects every PIN).
2. **Manual smoke test of the PIN gate** on `npm run dev` per the spec's 7-step checklist (clear cookies → /admin redirects → wrong PIN → see error → correct PIN → lands on /admin → refresh stays in → /admin/players direct hit redirects correctly).
3. ~~**TD22**~~ — **closed late evening 2026-05-24.** Polyfill in `tests/setup-dom.ts` rebinds `globalThis.localStorage`/`sessionStorage` from the JSDOM instance vitest exposes at `globalThis.jsdom`. Suite is **368/368** green again. Root cause was deeper than the original guess: Node 26 ships an experimental built-in `localStorage` global that returns undefined without `--localstorage-file`, and its descriptor wins against vitest's `populateGlobal` step. The `--localstorage-file` warning is gone from test output, confirming jsdom storage is now active.
4. **H3.1 — `seasons` table + migration** is the gating dep for everything in H3.x. **This is now the top remaining priority.**
5. **Small follow-up with Dad next time it comes up naturally:** Wayne Hashimoto (id=45) `preferred_tee_id` is NULL — does he actually play a specific tee, or is the league default (White/Yellow Combo) correct?
6. **Carry-over beta feedback from 2026-05-22:** confirm_join modal switch from one-button to two-button. Still outstanding.

### Doc-fix log (resolved this session, no longer carry-over)

- ✅ CLAUDE.md `played_with_matrix` schema corrected (was integer FK → now text full_name string). Caption added.
- ✅ New Engineering principle #4 added to CLAUDE.md.
- ✅ H1 withdrawn / D1 closed in ROADMAP.md.
- ✅ Phase E expanded with v2 items (E5 reframed, E6 added).
- ✅ H3.x sub-items added as season management precursor.
- ✅ Played With v2 Decisions Locked subsection added.
- ✅ **TD22 closed** — test env polyfill in `tests/setup-dom.ts` for Node 26 localStorage shadowing. Suite 368/368.

### Independent issues surfaced during TD22, not fixed

- **`tests/app/player-profile-ordering.test.tsx`** logs to stderr `supabase.from(...).select(...).eq(...).gt is not a function` — the test's supabase mock doesn't chain `.gt()` after `.eq()` for the `src/app/player/[id]/page.tsx:120` played-with query. Test passes only because the failed load is swallowed and the assertion doesn't depend on played-with data. Real coverage of that code path is missing. Worth a separate small task.
- **`DEP0205` Node deprecation** — `module.register() is deprecated. Use module.registerHooks() instead.` From vitest/vite internals on Node 26. Cosmetic; will resolve when vitest upgrades. Ignore.

---

## Previous session — 2026-05-22 (morning)

### Where we left off

Bug surfaced live this morning: Dad and Jonathan setting up teams on two phones at the same time merged into one team of 6 instead of two separate teams. Diagnosed as both concurrent race AND sequential stale-data collision on client-side team_number computation. Shipped ea04dd0: atomic team creation via Postgres RPC + picker refetch on open. Migration 011 applied to prod. Live-verified both scenarios with two devices — concurrent and sequential stale-data both produce correct sequential team numbers now. Additional manual verification: picker shows "Team N" captions for already-assigned players (refetch working), confirm_join modal fires correctly for mixed selection cases.

### Commits

- 7b490f2 — chore: resolve merge conflict in settings.local.json
- ea04dd0 — fix: atomic team creation via RPC + picker refetch on open; prevents both concurrent-device race and stale-data sequential collision

---

## Previous session — 2026-05-21

### Commits shipped today

| Hash | Message |
|------|---------|
| `3495720` | feat: Phase H.2.5 — snapshot handicap_index on round_players |
| `f212fec` | chore: update STATUS.md for 2026-05-21 H2.5 session |
| `07d630b` | feat: unify team formation entry points — replace legacy /round/new with PlayerPickerSheet, close TD19 |
| `da458bf` | feat: consolidate homepage team formation — yellow hero button, remove in-card duplicate, new empty state |
| `c11d16c` | chore: update STATUS.md for 2026-05-21 homepage polish session |

### What landed

**H.2.5 — Handicap Index Snapshot (`3495720`)**
- Migration `010_phase_h25_handicap_index_snapshot.sql` applied to prod via Supabase MCP
- `round_players.handicap_index_snapshot` column (nullable numeric) added + backfilled
- All INSERT paths updated: RoundSetup.tsx (`toggleInRoster`, `goToTeams`), page.tsx team formation handlers, scorecard
- CH math switched from `players.handicap_index` to `round_players.handicap_index_snapshot` across scorecard, summary, leaderboard, RoundResultsView
- LT1 self-heal gated on `is_complete = false` — finalized rounds no longer drift when HI changes
- Admin HI edit cascade: Players.tsx now also updates snapshot on all active-round `round_players` rows
- 10 new unit tests in `tests/lib/handicap-snapshot.test.ts`
- Live-verified: Gary S started a scorecard; `handicap_index_snapshot` populated on the new row

**TD19 closure — delete legacy `/round/new` route (`07d630b`)**
- Hero pill "+ Start a Scorecard" changed to `<button onClick={handleOpenPicker}>` — opens `PlayerPickerSheet` in `form_team` mode
- `/round/active/page.tsx` fallback link `/round/new` → `/`
- Entire `src/app/round/new/` directory deleted
- 1 new test: hero button opens picker, does not call `router.push`

**Homepage team formation polish (`da458bf`)**
- Hero button: label `+ Form a Team`, yellow `#e8a800` / `#1a1a1a`, `aria-disabled` + `opacity 0.4` when round complete
- Disabled-tap: amber toast ("Round is complete — new teams can't be formed.", 3 s, bg `#fdf0cc` / text `#854f0b`)
- `showToast` extended with optional `duration` + `variant` params — no new component
- Removed "Form a new team" in-card button entirely — hero is the only entry point
- Empty state: ⛳ + "No teams exist yet. Set one up by clicking '+ Form a Team' above." — matches leaderboard pattern
- Tests: 8 click targets updated `"Form a team"/"Form a new team"` → `"+ Form a Team"`, describe blocks rewritten, 1 new disabled-toast test

**Doc updates (this commit)**
- CLAUDE.md: removed deleted `round/new/page.tsx` from date-mock surfaces list
- ROADMAP.md: active priority order updated (H.2.5 complete, removed from queue), H2.5.1–H2.5.6 marked ✅, session log entries added
- STATUS.md: full rewrite

---

## Where we left off

- **356/356 tests** across 38 files. `tsc --noEmit` clean.
- **H.2.5 is live.** Migration 010 applied. Gary S snapshot confirmed on prod.
- **No active round.** The Thursday May 21 live round was the last one; round is finalized.
- **Homepage consolidated.** Single `+ Form a Team` yellow hero button; leaderboard-pattern empty state.
- **Phase H.2.5 fully closed.** All 6 sub-items ✅.

---

## Next priority

1. **Triage beta feedback** from today's live round — watch for UX bugs in the picker / Manage Team flow that surfaced with real users.
2. **Pick next phase:** H.2 (DB backup strategy) is the gating dependency for Phase E (historical import H.5). If backup work is too large, Phase E spec or Phase F.1 are alternatives.
3. **Add to ROADMAP** any new beta feedback items from today's round.

---

## Previous session — 2026-05-20 (late night PT)

### What landed

Beta feedback sprint for Thursday May 21 live round shipped end-to-end. Player-driven team formation + Manage Team is live (5 commits), blind-draw par display bug fixed, leaderboard now shows per-team THRU N / FINAL caption pro-tour style. Full suite at 344/344. Test rot from a hardcoded-date bug introduced May 20 was also caught and fixed. Round 103 on prod had 2 test scorecards (Teams 7 + 8) cleaned up via SQL Editor.

### Shipped commits

- **Commit 1** — Lift `ensureRoundShell` to `src/lib/round/`
- **Commit 2** — `smartJoin` pure logic + 9 tests
- **Commit 3** — `PlayerPickerSheet` component (two modes, mobile/desktop)
- **Commit 4** (`187f9ed`) — Homepage integration + write queue + smart-join branches + `JoinTeamConfirmModal` + `MixedTeamsErrorModal`
- **Commit 4.5** — Dedupe today's-teams section (was rendering twice); delete `TodaysTeamsList`; fold "Form a new team" into existing card
- **Commit 5** (`c7d4694`) — Manage Team button + sheet on scorecard
- **Commit 6** — Blind-draw par display bug (#2): `drawnPlayerPar` threaded through `results.ts` instead of hardcoded par-4
- **Commit 7** — Pin `todayLocal`/`yesterdayLocal` in `page-team-formation.test.tsx` (test rot introduced by `3b5c5e0`)
- **Commit 8** (`c89a504`) — Leaderboard per-team caption (#3): FINAL / THRU N / —

---

## Tech debt added this session

None new. Prior open items:
- **TD17** — Delete-scorecard affordance on admin RoundSetup. Per-team ⋯ delete with DangerModal; don't renumber gaps.
- **TD18** — Extract `Player` type to `src/lib/types.ts` (currently lives at `@/app/admin/page`; 5 team-formation files import from there).
- **TD20** — `withAdminFlags` in `src/lib/admin.ts` exported but unused. Will be used when summary↔scorecard linking surfaces.
- **TD21** — LT1 self-heal documentation: after H.2.5, the Decisions Locked entry needs a one-line amendment noting self-heal reads from snapshot and only fires on active rounds.

---

## Locked patterns added to CLAUDE.md

No new patterns this session. Existing patterns still in effect:
- **Per-player write queue** — port from RoundSetup.tsx when writing to `round_players`
- **Date-mock requirement** — tests touching `todayLocal`/`yesterdayLocal` must `vi.mock('@/lib/date')`

---

## Known prod state

- Round 103 (May 20): finalized blind-draw round with 6 real teams. Cleaned up.
- Round for May 21: played today; finalized.
- Migrations applied to prod: 001–010 (including 009 drops finalize trigger, 010 adds snapshot column).
- No active live round at sign-off.

---

## Open questions / decisions parked

- None new.

---

## Things to know that aren't obvious from code

- Default Claude Code model is `opusplan` (set in `.claude/settings.local.json`). Plan mode uses Opus, execution drops to Sonnet automatically.
- Pre-implementation walkthrough is the norm before any substantial Claude Code spec. Stack with plan-mode in Claude Code for best results.
- Type imports: `RoundPlayer` / `SmartJoinResult` from `src/lib/teamFormation/smartJoin.ts`. `Player` from `@/app/admin/page` (until TD18 extracts it). No parallel type definitions across team formation files.
- `handicap_index_snapshot` is now the canonical HI for all CH math. `players.handicap_index` is the live/current value only; `round_players.handicap_index_snapshot` is what was in effect at round time.

---

*If this file is more than 24 hours stale relative to your session work, flag it in the next session as a problem and reconcile before doing other work.*
