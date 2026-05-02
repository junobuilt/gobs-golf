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

## Tech stack

- **Frontend:** Next.js (App Router), TypeScript, React
- **Database:** Supabase (Postgres)
- **Hosting:** Vercel (auto-deploys from master branch)
- **Repo:** https://github.com/junobuilt/gobs-golf

---

## Workflow rules

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

### played_with_matrix
| column | type | notes |
|--------|------|-------|
| player_a | integer | FK → players |
| player_b | integer | FK → players |
| times_played_together | integer | |

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
  thomas-admin/
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

## Dangerous action pattern

Used consistently for: deactivate player, edit completed round, end round
early, remove player from round, move player between teams, change handicap
mid-round, change tee mid-round.

Pattern: tap → modal with warning icon → plain-English description → Cancel +
Confirm → Confirm button has 1.5s delay before tappable → "Cannot be undone"
where appropriate.

---

## Known issues / in-progress (as of May 1, 2026)

- Admin three-state flow not fully implemented — still shows assign UI on load
- Suggest Teams button still present in edit mode — needs removal
- Ball tie logic: "Tied" badge showing incorrectly when only 2 players tie
- Players tab mobile layout: table still rendering on small screens
- Round status "Complete" showing incorrectly when not all cards submitted
- Homepage: old scorecards still showing, need date filtering

---

## Players without handicaps (need data from Dad)

- Gary Tobian
- Gerry Heys
- Norm Cavanagh
- DeWaal Smith

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
