# GOBS Golf League App — Project Tracker

*Last updated: 2026-04-21 (end of scoping conversation)*

---

## Status at a glance

| | |
|---|---|
| **Current phase** | Phase 1 — Database schema + seed data (waiting on Dad's answers) |
| **Next milestone** | Working scaffold deployed to Vercel |
| **Target prototype date** | Weekend of 2026-04-25/26 |
| **Blocked on** | Dad's answers to requirements questions (sent) |
| **Not blocked on dad for** | Phase 0 (accounts + tool installs) — can start immediately |

---

## Phase roadmap

| Phase | What ships | Rough effort | Status |
|---|---|---|---|
| 0 | Accounts created, tools installed, empty Next.js deployed to a real Vercel URL | 1.5–2 hrs | ✅ Done |
| 1 | Database schema defined in Supabase, seeded with player names + course info | 30–45 min | 🟡 Blocked — waiting on Dad |
| 2 | Core app: player picker, scorecard entry, save round, view my rounds | 4–6 hrs | ⚪ Not started |
| 3 | Deploy, test on real phone, fix mobile quirks, share URL with dad | 1.5–3 hrs | ⚪ Not started |
| **4+** | **Post-MVP** — SWAT scoring, leaderboard, trends, historical import | TBD | ⚪ Parked |

**Total MVP effort: 7.5–12 hours (assuming maximum-efficiency path with Claude Code).**

---

## Decisions log

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Platform | Web app (PWA) — no app store | 60-80yo users, solo dev, days not weeks |
| 2 | Stack | Next.js + Supabase + Vercel | Boring, proven, free tier covers 50 users |
| 3 | Repo / hosting | GitHub + Vercel auto-deploy | Industry standard, zero config |
| 4 | Editor | Cursor (VS Code fork with AI) | Complements Claude Code |
| 5 | AI assistance | Claude Code once repo exists | 2x speedup on build/debug vs. copy-paste |
| 6 | Tracker | This file (PROJECT.md in repo) | Zero context-switching, lives with code |
| 7 | Historical import | Deferred to post-MVP | Weeks of cleanup, low value until app is live |
| 8 | Design phase | Skip — build with Tailwind defaults | Clean beats designed for internal tool |

### Pending (awaiting dad)

- MVP scope (scores only vs. full spreadsheet replacement)
- Per-round data model (total vs. hole-by-hole vs. match play)
- Scorekeeper pattern (individual vs. one-per-group vs. both)
- Auth approach (name dropdown vs. magic link vs. password)
- Historical import scope
- Homepage priorities (top 3 of 6)
- SWAT/money timing
- Course(s) — one home course or rotation?

---

## Phase 0 — Account & environment setup

| # | Task | Est. | Actual | Status | Notes |
|---|---|---|---|---|---|
| 0.1 | Create GitHub account | 5 min | | ⚪ | Use same email for all three |
| 0.2 | Create Supabase account | 5 min | | ⚪ | Link to GitHub for easier auth |
| 0.3 | Create Vercel account | 5 min | | ⚪ | Link to GitHub |
| 0.4 | Install Node.js (LTS) | 10 min | | ⚪ | nodejs.org |
| 0.5 | Install Cursor | 5 min | | ⚪ | cursor.sh |
| 0.6 | Install Claude Code | 15 min | | ⚪ | Walkthrough when you get here |
| 0.7 | Create empty Next.js project | 10 min | | ⚪ | Claude Code does this |
| 0.8 | Push to GitHub | 10 min | | ⚪ | Claude Code does this |
| 0.9 | Connect Vercel to repo, confirm deploy | 15 min | | ⚪ | First deploy to a real URL |
| 0.10 | Drop this PROJECT.md into repo | 2 min | | ⚪ | End of Phase 0 |

**Phase 0 definition of done:** You can visit a `something.vercel.app` URL on your phone and see the default Next.js welcome page.

---

## Phase 1 — Database schema + seed data

*Details added when we get here. Depends on dad's answers to questions 1, 2, 3, 4.*

Placeholder tables (likely, based on current assumptions):
- `players` — name, display_name, created_at
- `courses` — name, holes[], pars[], yardages[]
- `rounds` — date, course_id, created_by
- `scores` — round_id, player_id, hole_number, strokes

---

## Phase 2 — Core app

*Details added after Phase 1 lands.*

Likely screens:
- Home / player picker
- Start round (pick course if >1, pick players if scorekeeper mode)
- Scorecard entry (one hole at a time, big buttons)
- My recent rounds
- Single round detail view

---

## Phase 3 — Deploy, test, fix

*Details added after Phase 2 lands.*

Key testing targets:
- iPhone Safari (most of dad's friends)
- Android Chrome
- Tap targets large enough for older users
- Works on spotty golf-course cell signal
- Data persists between sessions

---

## Open questions

| # | Question | Who | Status |
|---|---|---|---|
| Q1 | MVP scope: scores only, or full spreadsheet replacement? | Dad | Sent |
| Q2 | Per-round data: total, hole-by-hole, or match-play? | Dad | Sent |
| Q3 | Scorekeeper pattern: individual, one-per-group, or both? | Dad | Sent |
| Q4 | Auth: name dropdown, magic link, or password? | Dad | Sent |
| Q5 | Import old scores? | Dad | Sent |
| Q6 | Handle non-phone-users how? | Dad | Sent |
| Q7 | What does a player see on homepage? (rank 1–6) | Dad | Sent |
| Q8 | When do we need SWAT/money side? | Dad | Sent |
| Q9 | What does SWAT stand for? | Dad | Sent |
| Q10 | Who's most/least tech-savvy in the group? | Dad | Sent |
| Q11 | One home course or rotation? Course name(s)? | Dad | Sent |

---

## Parking lot (revisit after MVP)

- SWAT match-play scoring engine
- Weekly team assignments interface
- Hole-in-One / BFB pot tracking
- Money/points running totals
- Season leaderboard
- Individual trend graphs
- Played-with matrix
- Historical data import from existing spreadsheet
- Handicap calculation
- Custom domain (e.g., gobsgolf.com)
- PWA "Add to Home Screen" prompt / icon polish
- Push notifications for round reminders
- Admin interface for dad to edit scores / manage players

---

## Things I learned the hard way (fill in as we go)

*Running log of "I wish I'd known that earlier" notes. Add as we hit them.*

- *(empty for now)*

---

## Links (fill in as created)

| What | URL |
|---|---|
| GitHub repo | *TBD* |
| Supabase project | *TBD* |
| Vercel deployment | *TBD* |
| Live app URL | *TBD* |
