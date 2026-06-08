# CC SPEC — Wave 1B: Team-Card Scoring Spine + Shambles

**Session type:** single CC session, 5 commits (Commit 0 = plan-mode audit). Plan-first. Do NOT write code until the Commit 0 audit + storage proposal is approved.

**Scope note — this is the architectural keystone of the format batch.** Four upcoming formats (Shambles, Texas Scramble, 1 Score Only, Alternate Shot) all need the same new thing: a **team-level scorecard** where the *team* is the scoring unit, one score per hole, no individual scores. The app today assumes every player has an individual scorecard. **1B builds that spine generically and wires only Shambles onto it.** The other three ride it in a later wave — so build the classification + surface to be format-agnostic, not Shambles-specific, even though only Shambles is registered now. This commit is bigger than 1A (the entry surface is genuinely new UI); if plan mode shows it's too large for one clean session, propose a split before starting.

---

## Product model (read first — this frames every decision)

- **Team-card formats** = the team turns in one number per hole (Shambles: best 1 or 2 balls, picked by the players on the course, entered as the result). There are **no individual scores** recorded.
- **Separate surface (locked).** Team-card formats route to a NEW team scorecard, NOT a mode bolted onto the existing individual scorecard. The individual scorecard (just rewired in 1A) is not to be touched.
- **Shambles specifics:** admin picks ball count **1 or 2**. Count-1 = one score box per hole. Count-2 = two score boxes per hole, and the hole's team score is the **sum of the two** (e.g. 4 + 5 = 9). Gross only. No GHIN. No individual season stats.
- **Roster is still captured normally** (same team formation as today) — it feeds played-with + the future pairing engine — even though individual scores are not.
- **Short teams play short (v1).** No adjustment, and critically **no blind draw** (see Commit 4 — this is the load-bearing divergence).

---

## Commit 0 (PLAN MODE ONLY — no code) — Audit + storage proposal

Produce and surface for approval:

1. **Score storage today.** How are individual scores stored and read? (the `scores` table — per `round_player`, per hole, `strokes` column.) Map it.
2. **Team-score storage proposal — THE key decision.** A team-card score is a *team-level* fact (per round, per team_number, per hole), not a per-player fact, and count-2 needs up to two counting balls per hole. Propose how to store this cleanly so it is **separable from individual scores** and never conflated with them. Surface options (e.g. a dedicated `team_scores` table vs. an alternative) with the tradeoffs, plus any migration. **Wait for approval before building.** Do not reuse a designated player's `scores` row to smuggle a team score — that conflates the two models and will leak into individual surfaces.
3. **Format classification.** How does a round know which scorecard surface to route to? Propose a single source of truth (e.g. an `isTeamCardFormat(format)` helper) that all routing + read sites consult. Register Shambles as the first team-card format; structure it so the other three formats can be added by one-line registration later.
4. **Every read site that aggregates scores into a team total / leaderboard / summary / "thru N" / finalize** — these all currently assume per-player scores. List each (file + line) and whether it must branch for team-card rounds.
5. **The finalize + blind-draw path — map it exactly.** Find precisely where blind draw fires on finalize (the per-team Submit → `finalize_round_with_blind_draws` path). Commit 4 must finalize team-card rounds WITHOUT triggering blind draw. Identify the exact gate point.
6. **Season-stats / profile read sites** that compute per-player scoring averages — confirm where they are, because the contract (below) is that team-card rounds must NOT feed them.

Output as a checklist + the storage proposal. This is the definition-of-done spine. Wait for approval.

---

## Commit 1 — Foundation: classification + team-score storage

- `isTeamCardFormat(format)` single-source helper (per audit). Shambles registered as team-card; built to accept the other three by registration later.
- Ball count stored in `format_config.shambles_ball_count` (or a generic `team_ball_count` if cleaner for the future formats — propose in audit), default 1, values 1 or 2.
- Team-score storage per the approved proposal (+ migration if needed). Additive only; all existing rounds remain individual-card and unaffected.
- A read helper that returns a team's per-hole score(s) and the derived hole total (count-2 → sum of the two balls).

**Tests:** storage round-trips; count-2 hole total = sum of the two entered balls; classification helper returns correct surface for Shambles vs. individual formats; absent ball-count → defaults to 1.

---

## Commit 2 — Team-card entry surface (NEW)

A new team scorecard surface for team-card formats. **Keep the entry UI visually close to the current scorecard** — same look/feel, NOT a redesigned big-button screen. The difference is *what's scored*: one team score row per hole instead of per-player rows.

- **Entry point:** any team member opens the **one shared team card** from their phone (tap their team → opens the shared card). Same card regardless of who opens it. **Last-write-wins** on concurrent edits (locked — two members editing is acceptable; standing-next-to-each-other reality; no conflict UI in v1).
- **Count-1:** one score box per hole. **Count-2:** two score boxes per hole; display the hole's summed total.
- **Dash until first tap, par-anchored** (same A6 behavior as the individual card): hole shows `—` until first +/− tap, which lands on par, then increments normally. Nothing written to storage until first tap.
- **Gross only.** The handicap allowance toggle is **disabled / greyed out** for team-card formats (locked — no per-player handicap to apply it to; same logic as Alternate Shot defines its own handicap reality). Surface a brief caption or disabled state so the admin understands why.
- Header shows the format chip (e.g. "Shambles") and ball count.

**Tests:** Playwright — open team card, enter count-1 scores, assert team total; switch a fixture to count-2, assert two boxes + summed hole total; assert dash-until-tap default; assert allowance control is disabled on a team-card round.

---

## Commit 3 — Routing + read surfaces

- **Routing:** a round on a team-card format opens the team-card surface; individual formats are unchanged. Single decision point via `isTeamCardFormat`.
- **Leaderboard + summary:** show **one team score** per team (total + "thru N"), no individual player rows. Expanding a team reveals the **team's hole-by-hole as a single row**, NOT per-player (there are no per-player scores). "thru N" = count of holes the team has scored.
- **Season-stats exclusion contract (load-bearing):** team-card rounds must NOT feed any per-player scoring average, profile stat, sparkline, or GHIN. A Shambles round contributes nothing to an individual's scoring history (the scores aren't individual and would be tainted by the format). This is the same principle as the 1A cross-round-aggregate boundary: *per-round competition formats never propagate into individual cross-round aggregates.* Confirm every season/profile read site from the audit excludes team-card rounds.

**Tests:** golden fixture — a Shambles round does NOT change any roster member's profile avg net / season net (assert unchanged vs. a baseline). Leaderboard ranks team-card teams correctly by team total. Summary expand shows one team row, no player rows.

---

## Commit 4 — Finalize WITHOUT blind draw (the load-bearing divergence)

**The risk this commit closes:** the existing per-team Submit flow fires blind draw on finalize. Blind draw copies a random *individual player's* scores to fill a short team. **Team-card formats have no individual scores to copy** — so firing blind draw on a Shambles round would try to draw scores that don't exist. This is the single most likely surprise bug in 1B.

- **Reuse** the per-team "Submit Final Scores" button and the round-finalize flow. Submission is already team-level, so it fits.
- **Gate blind draw OFF** for team-card formats at the finalize point identified in the audit. A team-card round finalizes by flipping `is_complete = true` and any existing submitted-teams bookkeeping — but **does NOT** invoke the blind-draw draw/insert. No `blind_draws` rows are created for team-card rounds.
- **Short teams play short.** A 3-man Shambles team in a 4-man round finalizes with its actual played score, no fill, no adjustment.

**Tests — golden fixtures with negative controls:**
- A short team-card round (one team smaller than the max) finalizes → assert `is_complete = true` AND **zero `blind_draws` rows created** AND the short team's total = its played score.
- **Negative control:** the fixture must be shaped so that, on an *individual* format, blind draw WOULD fire — proving the gate is doing real work, not passing trivially.
- An individual-format round still fires blind draw normally (assert the gate didn't break existing behavior).

---

## What NOT to change
- Do NOT touch the individual scorecard surface (the 1A-rewired screen) or its read-path. Team card is a separate surface.
- Do NOT change blind-draw behavior for individual formats (2-Ball, 3-Ball, Best Ball). Only gate it OFF for team-card formats.
- Do NOT feed team-card scores into individual season stats, profile averages, sparklines, or GHIN.
- Do NOT apply the handicap allowance to team-card formats (disable the control).
- Do NOT add an individual-score entry path for Shambles (no "enter all four, app picks best"). The team enters the counting score(s) directly — locked.
- Reuse existing team formation, the per-team Submit button, and the `DangerModal` pattern — do NOT rebuild them.
- Do NOT build the other three team-card formats (Texas Scramble / 1 Score Only / Alternate Shot) here — spine must accept them later by registration, but only Shambles is wired in 1B.

## Verification gates
- `tsc --noEmit` clean.
- Full unit suite green; new golden-fixture tests for Commits 1, 3, 4 included, with negative controls (esp. the blind-draw gate).
- Playwright for the team-card entry surface (Commit 2) and the team-card leaderboard/summary display (Commit 3).
- `STATUS.md` updated.

## Confession section (required in final summary)
List explicitly: the approved team-score storage model and why; every score-aggregation read site and whether it branches for team-card rounds; the exact blind-draw gate point and how team-card finalize diverges from individual finalize; every season/profile read site and confirmation it excludes team-card rounds; anything considered but not changed; any surface where team-card display differs from individual and why.

## Open Dad question (does NOT block this spec)
Money is on Shambles rounds. When a money Shambles has uneven teams (a 3-man vs. 4-man teams), how does the league handle the short team's disadvantage — any adjustment, or play short? v1 plays short either way; any *pot* fairness handling belongs in the payout track, not the scoring spine. Log for Dad; do not build here.
