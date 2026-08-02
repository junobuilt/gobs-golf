# Tournament Scoring & Cup — Code Review (CC Spec 5)

**Date:** 2026-07-31 · **Branch:** `tournament` @ `b89fe57` · **Mode:** READ-ONLY (no source changed)
**Reviewer:** Claude Code (senior-dev correctness pass)

## Summary

The tournament scoring engine and cup-verdict logic are, on correctness, in good
shape: the SSOT discipline is real (one engine, one verdict helper, one strokes
helper, read-through loaders), the cup thresholds are dynamic and the eval order
is sound, and the highest-risk paths (walk-off, best-net, day-side isolation) are
conservative-by-construction. **No confirmed P0.** The material findings are all
in the **durability/UX layer of the write queue on the tournament scorecard**
(the parked "Item B") — the tournament card lacks the end-of-round reconciliation
and non-persistent-storage warnings the league card has — plus a handful of
cup-threshold edge questions and display-only nits. Two items are marked **HOLD
FOR JONATHAN** because they can silently lose a player's un-synced scores.

> Verification note: this was a static read of the source + tests. I did **not**
> run vitest/Playwright/tsc (read-only session, and a live league round is being
> entered into prod). The `tournament-test-playbook.md` referenced in the spec
> does not exist in the repo, so handicap rules were checked against the code's
> own doc-comments + `tests/lib/tournament/*`, not against that playbook.

### Severity table

| # | Sev | Area | File | One-liner |
|---|-----|------|------|-----------|
| 1 | **P1 · HOLD** | Persistence | `src/lib/writeQueue/storage.ts:42`, `instance.ts:36` | `isPersistent()===false` (localStorage disabled / private browsing) is never surfaced — scores go to an in-memory queue and vanish on tab close with **no warning**, on *every* scorecard incl. the live league round. |
| 2 | **P1 · HOLD** | Persistence | `src/app/tournament/match/[matchId]/page.tsx:404` | Tournament scorecard has **no end-of-round reconciliation / stale-failure dialog / manual retry** — only a passive amber banner. A terminal-failed tournament score has no user-facing recovery path (the league card has `StaleFailureDialog`). |
| 3 | P2 | Cup math | `src/lib/tournament/cup.ts:14`,`53` | `winLine = total/2 + 0.5` is derived from **match count only**; point-adjustments (`tournament_point_adjustments`) inflate banked points but not the win line — a large/asymmetric adjustment can move the verdict without a matching change to the threshold pool. Design question, not a proven defect. |
| 4 | P2 | Cup math | `src/lib/tournament/cup.ts:54`,`deriveCupBar:109` | `isIncomplete` / phantom matches (a side short a player, never played, never envelope-resolved) still count toward `total` and `remaining`, so they raise the win line and keep the cup "in progress" indefinitely until an admin envelope-resolves them. Operational, not a code bug. |
| 5 | P2 | Display | `src/lib/tournament/matchStatus.ts:67` | "Dormie" and `thru N` use `remaining = 18 − thru` where `thru` is the **consecutive-from-start** count; with a data-entry gap or shotgun rotation this under-/over-states remaining, so Dormie can fail to show and "thru N" can lag the pts. Display-only; the engine's authoritative closeout is unaffected. |
| 6 | nit | Display | `src/components/tournament/PointsBar.tsx:110` | Gold "clinch" line is hard-pinned at `left: 50%` (the midpoint), but the true win line is `total/2 + 0.5`. Off by half a match visually; exact numbers are in the captions (already acknowledged in-code). |
| 7 | nit | Cup math | `src/lib/tournament/cup.ts:61` | Null-holder branch: if adjustments pushed **both** sides ≥ winLine, it returns side "a" unconditionally (checks A before B) rather than the higher side. Only reachable with net-positive adjustments on both sides. |
| 8 | nit | Tests | (missing) | Spec's `tournament-test-playbook.md` is absent; handicap-rule parity is asserted only by unit tests, not a human-readable worked-example doc. |

---

## Findings (detail)

### 1 — P1 · HOLD FOR JONATHAN — Non-persistent storage fallback is silent
**File:** `src/lib/writeQueue/storage.ts:35-44`, consumed via `src/lib/writeQueue/instance.ts:36-42`

`createStorage()` correctly falls back to an in-memory map and reports
`isPersistent() === false` when `localStorage` is unavailable (private browsing,
hardened browsers, storage disabled). **But `isPersistent()` is called nowhere in
`src/`** (grep: only its own definition + storage). The design doc's own edge-case
row mandates "Fall back to in-memory queue with **prominent warning banner**"
(`docs/option-3-write-queue-design.md`, D1 / edge cases). That banner does not
exist on any surface — league or tournament.

**Why it matters:** on such a device the queue is memory-only. A score is set
optimistically, held in RAM, and **lost on tab close/eviction with zero user
signal** — the exact "scores reverted" class the queue was built to kill, now
just narrowed to one device profile. This affects the **league round being
entered right now**, not only tournaments.

**Failure scenario:** player in iOS Safari private mode enters 9 holes → backgrounds
the app → OS evicts the tab → reopens → 9 holes gone, no warning ever shown.

**Suggested fix (described, not applied):** on scorecard mount, check
`getWriteQueue().isPersistent()` (and the team queue) and render a persistent
warning banner when false. Parked Item B — confirm with Jonathan before touching.

### 2 — P1 · HOLD FOR JONATHAN — Tournament scorecard lacks reconciliation/recovery UI
**File:** `src/app/tournament/match/[matchId]/page.tsx:217-234, 404-420`

The tournament card wires the queue for writes (`getWriteQueue().enqueue`,
`getTeamWriteQueue().enqueue`) and shows a passive `sync-failed-banner` when any
item goes `terminal_failure`. It does **not** implement Phase D/E of the write-queue
design: no hail-mary drain on finish, no "N scores didn't sync" dialog, no
per-score list, no `retryTerminal`/`markAsTerminal`/`forget`, no copy-details.
The league surfaces do (`src/app/page.tsx:471-480,732` + `round/[id]/scorecard`
import `StaleFailureDialog` / `stuckItemsClipboard`).

**Why it matters:** if a tournament score goes terminal (e.g. 6h stuck, or a
`round_finalized`/RLS terminal classification), the scorer sees only "some scores
haven't synced" with **no way to see which, retry them, or copy them for the
admin** from the tournament card. Recovery depends entirely on background retry
succeeding before the 6h terminal cutoff.

**Suggested fix (described, not applied):** port the league card's
`StaleFailureDialog` + hail-mary/retry wiring to the tournament match page (both
queues). Parked Item B — confirm scope with Jonathan; this is a known gap, not a
regression.

> Read-too-soon (related, LOW): `initialLoad` does **not** drain the queue before
> seeding state; instead `reconcileScores` overlays pending+in-flight queue items
> onto server truth (`page.tsx:135-149`), which is a valid alternative that keeps
> un-synced writes visible. The only residual is a sub-second race where a write
> confirms (removed from queue) between the server read and the overlay, briefly
> dropping the value from the overlaid map; it self-heals on the next refresh.
> Consistent with Item B's parked status — noted, not a fix target.

### 3 — P2 — Win line ignores the point-adjustment pool
**File:** `src/lib/tournament/cup.ts:14-16` (`cupThresholds`), `44,53` (consumed)

`winLine = total/2 + 0.5` is a function of created-match count only. `pointsA/B`
fed to `cupOutcome` are `standings.banked`, which **include**
`tournament_point_adjustments` (`matchplay.ts:computeTournamentStandings`). So an
adjustment shifts a side's points toward the win line without changing the line.

**Why it matters:** an envelope-rule half-point that *replaces* an unplayable
match is legitimate against a fixed pool — but if that match was **not** created
as a match row, `total` under-counts the true pool and the win line is a half-low;
conversely a bonus adjustment on top of a full match slate lets a side clinch with
fewer than a real majority of matches. Whether this is correct depends on the
GOBS envelope/adjustment convention, which I can't confirm from code.

**Suggested fix (described):** decide the intended semantics (does the win line
move with adjustments?) and, if so, base the threshold on
`total + Σ|adjustment budget|` or model envelope points as match rows. **Question
for Jonathan — do not change behavior without the rule.**

### 4 — P2 — Incomplete/phantom matches inflate `total` and `remaining`
**File:** `src/lib/tournament/cup.ts:54,69,81`; `loadMatch.ts:227-229`; `deriveCupBar` `cup.ts:107-110`

A match row with a side short its complement is `isIncomplete` and the engine
cannot decide it from scores, so `resolved.result` stays null. It still counts in
`total` (raises the win line) and in `remaining` (keeps `challengerMax` high →
"in progress"). If it's never played and never envelope-resolved, the cup can't
clinch even when every real match is done.

**Why it matters:** operationally the admin must envelope-resolve any phantom
match or the verdict never fires. Correct-by-design, but non-obvious.

**Suggested fix (described):** none required; consider surfacing "N matches
unresolved" on the admin cup view so a phantom can't silently stall the verdict.

### 5 — P2 — `matchStatus` remaining/Dormie uses consecutive `thru`
**File:** `src/lib/tournament/matchStatus.ts:66-71`

`remaining = TOTAL_HOLES − st.thru`, and `st.thru` stops at the first gap in play
order (`matchplay.ts:206-210`). With an out-of-order entry or a shotgun start,
`thru` undercounts holes actually played, so `remaining` is too large: "Dormie"
(`lead === remaining`) may never render, and the "thru N" context can lag the pts
(which derive from all resolved holes). The engine's **authoritative** closeout
uses `effectivePlayed` (gaps skipped, `matchplay.ts:245-251`) and is unaffected —
this is display-only.

**Suggested fix (described):** derive the status chip's `remaining` from the same
resolved-count basis the engine uses, or pass `effectivePlayed` through on
`MatchState`. Low priority.

### 6/7/8 — nits
- **6** `PointsBar.tsx:110` — gold clinch line at `50%` ≠ true win line `total/2+0.5`; captions carry exact numbers (in-code comment already notes this).
- **7** `cup.ts:60-63` — null-holder both-sides-≥-winLine returns "a" by check order; unreachable without dual net-positive adjustments.
- **8** `tournament-test-playbook.md` referenced by the spec is missing; no human-readable worked-example guard for the handicap rules (only `tests/lib/tournament/*`).

---

## Looks correct / verified

- **Cup verdict SSOT** (`cup.ts:43-85`): eval order challenger-win → holder-majority →
  holder-retain → in-progress is sound; `winLine` dynamic off live `total`;
  `holder_side` read live from the DB incl. null; `challengerMax = challengerPts +
  remaining×1` correctly leaves a live match able to swing a full point (the ×0.5
  trap is explicitly tested, `cup.test.ts:124-131`). Acceptance + dynamic-threshold
  + null-holder cases all covered.
- **Single verdict feed**: `deriveCupBar` → `cupOutcome` is the only path; all three
  surfaces (Home hero, Tournament Home, Scoreboard) render `PointsBar` off the same
  `DashboardData`, asserted identical in `tournament-cup-surfaces.test.tsx` (a),(b),(c).
- **Greensomes team handicap** (`matchplay.ts:36-45`): `round(0.6·low + 0.4·high)`,
  order-independent, single helper, shared by engine + preview via `matchStrokes.ts`.
  The (3·low+2·high)/5 "never lands on .5" rounding argument holds.
- **Match strokes** (`matchplay.ts:52-58`): everyone off the low unit, clamp at 0;
  four-ball/singles at 100% CH (deliberate, documented), greensomes collapses first.
- **Best-net ball selection** (`matchplay.ts:138-166`): side value = min matchNet
  across present balls, so a higher-gross/lower-net ball correctly wins; counting-ball
  = argmin with tie→null (mark both). Correct.
- **Walk-off / early close** (`matchplay.ts:229-266`): closeout only when
  `|cumA−cumB| > total − played` with unplayed *and gap* holes counted as swingable
  — strictly conservative, never closes early on an incomplete card; byte-identical to
  the pre-shotgun engine for start=1/no-gaps.
- **Halved match** → `0.5/0.5` (`countryPointsForResult:308-313`); standings always
  derived, never stored (`computeTournamentStandings:337-378`).
- **Admin override precedence** (`resolveMatchResult:321-331`): admin result wins
  unconditionally, engine view always surfaced alongside; engine never persists into
  `match.result`, so the derived path can't go stale.
- **Day-side isolation (Item 6)**: scoring reads the **built** `match.side_*_team_number`
  filtered against `round_players.team_number` (`loadMatch.ts:143-144`); day-side
  overrides write only to `tournament_day_sides` (`mutations.ts:256-273`) and only gate
  the pairing pool at build time (`createGroup:649-658`). A post-build day-side change
  cannot corrupt an existing card. Confirmed.
- **Score-read cap safety** (`loadMatch.ts:34,310-318`): per-round `.in()` scope stays
  under the 1000-row cap and throws `ScoresTruncatedError` if it's ever breached —
  the History-fix lesson applied.
- **Write-queue core** (`WriteQueue.ts`): collapse-by-key (D4), in-flight resurrection
  on load (`103-109`), backoff schedule (`backoff.ts`), terminal classification
  (`instance.ts:160-183`), quota eviction order (`storage.ts:68-87`) all match the
  locked design. The gaps are wiring/UX (findings 1–2), not the engine.
