# CLAUDE.md — GOBS Golf Project Briefing

This file is read automatically by Claude Code at the start of every session.
It contains everything needed to work on this project without re-briefing.

---

## What this app is

GOBS Golf is a web-based scoring and league management app for a private golf
league of ~50 players (aged 60-80) who play weekly at Semiahmoo Golf & Country
Club in Washington State. The app replaces a manual spreadsheet system.

The primary admin user is Thomas (the owner's son). Players access the app on
their phones during rounds to enter scores. No app store distribution — web/PWA
only.

---

## Canonical project documents

Consult these at the start of any session:

- **[ROADMAP.md](./ROADMAP.md)** — source of truth for *what* to build. Phase
  list, item statuses, locked decisions, open questions. Read before
  taking on feature work.
- **[GOBS_Game_Rules_v1.pdf](./GOBS_Game_Rules_v1.pdf)** — source of truth for
  *how* scoring works. Game formats, handicap application, blind draw,
  money allocation. Read before changing scoring logic or display.

---

## Working principles for this project

### Plan-first protocol
For any code change beyond a one-line typo fix:
1. Show the plan before writing code (files, what each change does, hypothesis)
2. Wait for approval
3. Implement
4. Show the diff grouped by item, line by line
5. List anything considered but not changed (out of scope)
6. Run verification (npm test, tsc --noEmit)
7. Commit and push to origin/master

### Anti-drift rules
- Do not refactor unrelated code, even in files being touched
- Do not "clean up" formatting, comments, imports, or styling outside scope
- Do not modify items in ROADMAP.md's "Decisions Locked" section
- If a bug is found while working, log it but do not fix
- If the existing math has subtle bugs, STOP and report rather than silently
  changing behavior

### Commit and push together
"Commit" without push leaves changes in local repo only. Always push to
origin/master unless explicitly told otherwise.

### Confession is mandatory
At the end of every plan or implementation, list:
- What you considered changing but did not (out of scope)
- Bugs/oddities flagged but not fixed
- Any drift from the explicit prompt scope (font sizes, margins, etc.)

### Verification scales with risk
- Schema changes: verify against live data before commit
- Math changes: snapshot test against existing production data
- UI changes: type-check + manual screenshot
- Refactors: snapshot test + unit tests

### STATUS.md maintenance
At the end of every working session, before signing off, update `STATUS.md`
at the repo root. This is non-negotiable — `STATUS.md` is the canonical
session-handoff artifact. Use the exact template defined in `STATUS.md`
itself. Commit it as part of your final commit, or as a separate trailing
commit titled `chore: update STATUS.md`. Push before signing off. If you
forget, the next session will start with stale state and waste time.

`STATUS.md` is auto-published by GitHub Pages (source = `master`, path = `/`)
at `https://junobuilt.github.io/gobs-golf/STATUS.md`. A fresh session should
fetch it alongside `ROADMAP.md` before doing anything else.

---
## Tech stack

- **Frontend:** Next.js (App Router), TypeScript, React
- **Database:** Supabase (Postgres)
- **Hosting:** Vercel (auto-deploys from master branch)
- **Repo:** https://github.com/junobuilt/gobs-golf

---

## Workflow rules

- **First action of every session: `git fetch origin`.** Before making any
  claim about what is or isn't on master — what's shipped, what production
  is running, whether a feature exists yet — fetch the remote. Local
  `master` can be stale by many commits without warning. Asserting state
  from local refs alone has produced wrong answers in the past (e.g.,
  "PR 1 + PR 2 are not on master" when they were already in production).
  No exceptions: fetch first, then read.
- **Always commit directly to master.** Do not create feature branches or pull
  requests unless explicitly asked.
- **Always pull latest master before making changes:**
  `git pull --ff-only` or `git fetch origin && git rebase origin/master`
- **One focused change per session.** Don't bundle unrelated fixes.
- **Show the relevant code before changing it.** Read first, plan second, edit
  third.
- **Run `tsc --noEmit` after every change** to catch type errors before
  committing.
- **After completing changes, confirm each item was addressed.** If anything
  was skipped, say so explicitly.
- **Claude Code runs the Bash tool (bash), NOT PowerShell.** Do not use
  PowerShell here-string syntax (`@'...'@`) in bash commands — it leaks
  literal `@` characters (bit us on commit messages twice). Use bash
  heredocs (`<<'EOF' ... EOF`) for multi-line content.

---

## Database schema (Supabase)

### players
| column | type | notes |
|--------|------|-------|
| id | integer | primary key |
| full_name | text | |
| display_name | text | short name shown on scorecard |
| handicap_index | numeric | nullable — some players missing |
| is_active | boolean | deactivate don't delete |

### tees
| column | type | notes |
|--------|------|-------|
| id | integer | primary key |
| color | text | Blue, White, Yellow, White/Yellow Combo |
| slope_rating | numeric | |
| course_rating | numeric | |
| par | integer | |
| sort_order | integer | |

White/Yellow Combo is tee id=4. Uses estimated rating 67.6 / slope 120 until
official number obtained from pro shop.

### holes
| column | type | notes |
|--------|------|-------|
| id | integer | primary key |
| tee_id | integer | FK → tees |
| hole_number | integer | 1–18 |
| par | integer | |
| yardage | integer | |
| stroke_index | integer | handicap allocation 1–18 |

### rounds
| column | type | notes |
|--------|------|-------|
| id | integer | primary key |
| played_on | date | |
| course_id | integer | |
| is_complete | boolean | |
| created_at | timestamp | |

### round_players
| column | type | notes |
|--------|------|-------|
| id | integer | primary key |
| round_id | integer | FK → rounds |
| player_id | integer | FK → players |
| tee_id | integer | FK → tees |
| team_number | integer | 0 = unassigned |
| course_handicap | numeric | calculated at time of round |

### scores
| column | type | notes |
|--------|------|-------|
| id | integer | primary key |
| round_player_id | integer | FK → round_players |
| hole_number | integer | 1–18 |
| strokes | integer | |

### league_settings
| column | type | notes |
|--------|------|-------|
| key | text | primary key |
| value | text | stored as string |

Keys in use: `show_leaderboard`, `show_weekly_winners`, `two_ball_scoring`,
`buy_in_amount` (default "10")

*(The legacy `played_with_matrix` view was DROPPED in migration `015_drop_played_with_matrix_view.sql` with the Phase E6 admin Played-With redesign — 2026-06-06. All Played-With surfaces now compute from `round_players` via `src/lib/playedWith/compute.ts`. Its schema entry was removed from this doc 2026-06-09.)*

---

## Design system

### Colors
- Topbar background: `#0b2d50` (deep navy)
- Hero section background: `#0e4270` (mid navy)
- Page background: `#f2f1ed` (warm off-white)
- Primary CTA button: `#e8a800` (yellow), text `#1a1a1a`
- Secondary/green button: `#276e34`
- Danger button: `#8c2424` or outline `#c0392b`
- Stats row: white cards (`#fff`) with `0.5px solid #e4e4e4` border on
  `#f2f1ed` background — never inside the navy hero

### Typography
- Font: Inter (Google Fonts), `-apple-system` fallback
- Weights: 400 regular, 500 medium, 600 semibold, 700 bold
- Never use condensed or stiff fonts

### Components
- Cards: white bg, `0.5px solid #e4e4e4`, `border-radius: 10px`
- Tabs: white bg, `#0b2d50` active underline, horizontally scrollable on mobile
- Dangerous action modal: warning icon, plain-English description, Cancel +
  Confirm buttons, Confirm has 1.5s delay before tappable

### Team color system (12 colors, assigned in order)
```
Team 1:  border #276e34,  bg #f3faf5,  pill bg #e4f5e9,  pill text #276e34
Team 2:  border #b87020,  bg #fdf7ee,  pill bg #fdeedd,  pill text #8c5010
Team 3:  border #aaaaaa,  bg #f8f8f8,  pill bg #efefef,   pill text #888888
Team 4:  border #1a6fa8,  bg #eef5fc,  pill bg #deeefa,  pill text #1a5a8c
Team 5:  border #8b2fc9,  bg #f6eefe,  pill bg #eeddf8,  pill text #6a1fa8
Team 6:  border #c0392b,  bg #fdf0ee,  pill bg #fde0dc,  pill text #9a2a20
Team 7:  border #1a8c7a,  bg #eef8f6,  pill bg #d8f2ed,  pill text #136858
Team 8:  border #c47d00,  bg #fef9ee,  pill bg #fdf0cc,  pill text #9a6000
Team 9:  border #2b5ba8,  bg #eef1fa,  pill bg #dde4f8,  pill text #1e3f80
Team 10: border #a04020,  bg #faf0eb,  pill bg #f5ddd0,  pill text #7a2e14
Team 11: border #5a7a20,  bg #f2f7e8,  pill bg #e4efd0,  pill text #3e5a14
Team 12: border #6a4a9a,  bg #f4f0fa,  pill bg #e8dff5,  pill text #4e2e7a
```
TEAM_COLORS is defined in `src/lib/teamColors.ts` and imported wherever needed.

---

## App structure

```
src/app/
  page.tsx                    — Homepage (today's scorecards)
  layout.tsx                  — Root layout, global nav
  admin/
    page.tsx                  — Admin shell, loads settings
    tabs/
      RoundSetup.tsx          — Round setup (three-state flow)
      Players.tsx             — Player management
      PlayedWith.tsx          — Played-with matrix
      Money.tsx               — Money tracker
      History.tsx             — Historical rounds
      Settings.tsx            — League settings + toggles
  scorecard/
    page.tsx                  — Hole-by-hole score entry
  summary/
    page.tsx                  — Round summary
  leaderboard/
    page.tsx                  — Season leaderboard
  players/
    [id]/page.tsx             — Individual player profile
src/lib/
  teamColors.ts               — TEAM_COLORS constant (shared)
  supabase.ts                 — Supabase client
```

---

## Admin panel — three-state flow (RoundSetup.tsx)

**State 1 — No round today:**
Empty state with yellow "+ Create today's round" CTA. No other buttons.

**State 2 — Round active (default view when round exists):**
Shows today's scorecard cards color-coded by team number. Yellow "Edit teams"
button at bottom. Red outline "Delete round" button below that. No prompting
to assign teams — just shows current state.
Triggered when: round exists for today AND any round_players have team_number > 0.

**State 3 — Edit mode (activated by tapping "Edit teams"):**
- Navy edit banner with yellow "Done ✓" to exit
- Sticky unassigned players pool bar (position: sticky, background #1a5a8c)
- Autosave: every assignment writes immediately to Supabase
- Undo toast: 5 seconds, yellow "Undo" text, reverses last action
- Bottom sheet for team assignment on mobile
- No "Update teams" button — autosave replaces it

---

## Scorecard — ball selection logic

- Always select best 2 net scores as Ball 1 and Ball 2
- Recalculate on every score change
- If exactly 2 players tie for lowest: both get Ball 1 / Ball 2, no Tied badge
- "Tied" badge only appears when 3+ players share the same net score
- When tied: show amber note "X ties for Ball 2 — tap to override"
- All-par tie: assign Ball 1 / Ball 2 to first two players by roster order

---
## Locked patterns

Patterns the codebase reuses across surfaces. When you're building a new
surface that touches the same problem space, port the pattern rather than
inventing a new one.

### Per-player write queue
When a UI surface writes to `round_players` rows in response to user taps
(check-in, team assignment, Manage Team, etc.), port the queue pattern
from `src/app/admin/tabs/RoundSetup.tsx` — see the May 10 session log
entry "admin read + write-race fix" in ROADMAP.md for context.

Shape:
- `useRef<Map<player_id, Promise<void>>>` keyed by player_id
- `enqueuePlayerWrite(playerId, fn)` chains the write onto that player's
  promise so writes for the same player serialize, while cross-player
  writes still run in parallel
- `drainWrites()` awaits all queued writes; call it before any route
  change, reload, or sheet close that depends on the writes being
  durable

Why: rapid tap patterns (check player in → assign to team) can fire
INSERT and UPDATE near-simultaneously. Without serialization the UPDATE
can match 0 rows silently and team assignments are lost.

Surfaces using this pattern: `RoundSetup.tsx`, `src/app/page.tsx` (team
formation), `src/app/scorecard/page.tsx` (Manage Team).

---

### Date-mock requirement for tests

Any test that exercises code calling `todayLocal()` or `yesterdayLocal()`
from `src/lib/date.ts` **must** pin the date via `vi.mock('@/lib/date')`.

```ts
vi.mock("@/lib/date", () => ({
  todayLocal: () => "2026-05-20",
  yesterdayLocal: () => "2026-05-19",
}));
```

Why: without the mock, tests pass on the day they are written (the real
`todayLocal()` matches the hardcoded test fixture), then silently fail on
every subsequent day. Caught 2026-05-20 when `page-team-formation.test.tsx`
started failing after the `3b5c5e0` commit — the test had been written the
same day as the fixture and no mock was added.

Surfaces affected: any component or hook that reads today's round date
(`page.tsx` homepage, `leaderboard/page.tsx`, `admin/tabs/RoundSetup.tsx`,
`round/active/page.tsx`) and any test that renders
or calls those surfaces.

---

## Dangerous action pattern

Used consistently for: deactivate player, edit completed round, end round
early, remove player from round, move player between teams, change handicap
mid-round, change tee mid-round.

Pattern: tap → modal with warning icon → plain-English description → Cancel +
Confirm → Confirm button has 1.5s delay before tappable → "Cannot be undone"
where appropriate.

---

## Known issues / in-progress (as of May 20, 2026)

---

## What NOT to do

- Never create branches or PRs unless explicitly asked
- Never hardcode the $10 buy-in amount — read from league_settings
- Never delete players — deactivate only (is_active = false)
- Never render stats row inside the navy hero div
- Never use the Toggle component from RoundSetup — it was removed. Toggles
  live only in Settings.tsx
- Never bundle multiple unrelated changes in one commit
- Never skip the tsc --noEmit check

---

## AI workflow patterns

Jonathan is learning AI-assisted-dev patterns. When you notice a fit, proactively suggest:

---

## Engineering principles for CC sessions

These were surfaced during 2026-05-22's historical-data-import session and apply broadly. Treat them as binding rules when planning and writing code, not just suggestions.

### 1. Writes must audit all reads

When changing what column a query writes, filters, or sorts by, grep for every downstream consumer of that column before shipping. The 2026-05-22 session had three separate bugs from this blind spot (HI label reading wrong column, tee.course_id filter returning NULL silently, created_at sort across 4 tables). For each column being written or modified: list which UI surfaces, queries, and sort orders read it, and verify each is correct under the change. The audit pass should be explicit in the plan, not implicit.

### 2. Supabase PostgREST fails silently

The Supabase client returns "successful" empty/unfiltered/unsorted results when the API shape is wrong (e.g., wrong column name, wrong `referencedTable` semantics on 1:1 vs 1:N joins, missing required filters). Don't trust unit tests against a mocked client alone — the mock might encode your mental model of the API rather than PostgREST's actual behavior.

For any code touching Supabase queries: include a smoke check that verifies the live data shape matches expectations, OR add an explicit comment in the test explaining how the mock matches PostgREST's actual runtime behavior (not the documented intent). When PostgREST silently returns the wrong shape, the error surfaces as a confusing UX bug days later — much harder to diagnose than a clear runtime exception.

### 3. Test fixtures must not accidentally pass

When writing a test for an ordering, filtering, or transformation behavior, the input fixture must be in a state where the code under test must do real work for the assertion to pass. Specifically:

- For sort tests: seed data in the WRONG order so the test fails without the sort code running.
- For filter tests: seed at least one row that should be excluded by the filter.
- For transform tests: seed input that differs from expected output.

A test whose fixture already satisfies the assertion before the code runs is a confirmation-bias trap. The 2026-05-22 round-sort test passed initially because the mocked Supabase response was already in correct order — the sort code could have been a no-op and the test would still have passed. Verify negative-control (the test fails with the code removed) for every new behavioral test.

### 4. Player-default questions: assume DB row, not code

When a spec says "player X is hardcoded to do Y" (default tee, default format, default anything), the default assumption is that Y is stored in a per-row column on `players`, not in code. The `players.preferred_tee_id` pattern shipped 2026-05-10 is the existing template: code reads `player.preferred_tee_id ?? DEFAULT_TEE_ID` generically; the per-player exception lives in the DB row. Always verify the source before proposing edits — `grep` the codebase for the player's name, and query the DB for the value. The 2026-05-24 Jeff Irvin spec said "Wayne is hardcoded to White tees"; reality was `players.preferred_tee_id = 2` for Wayne Vincent (id=55), with Wayne Hashimoto (id=45) actually NULL. The fix was a single SQL UPDATE on Jeff's row, no code change. Plan-first protocol caught this; binary-typo-fix-style edits would have created phantom code.
