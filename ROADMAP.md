# GOBS Golf — Feature Roadmap
*Last updated: April 27, 2026*

---

## How to use this file
- ✅ Done — shipped and working
- 🔨 In Progress — actively being built
- 📋 Ready — spec is clear, can be built anytime
- ❓ Blocked — needs info from Dad or a decision
- 💡 Idea — parked for later, needs scoping

---

## MVP (Shipped)

| Feature | Status | Notes |
|---|---|---|
| Player roster (45 players seeded) | ✅ | From 2025 spreadsheet |
| Course/tees/holes data (Semiahmoo) | ✅ | Blue, White, Yellow tees |
| Admin team builder | ✅ | Thomas can pre-make teams |
| Start a Scorecard (tap-to-select) | ✅ | On-the-spot team creation |
| Tee selection with CH calculation | ✅ | Per-player, per-tee |
| Hole-by-hole score entry | ✅ | +/- buttons, hole nav dots |
| Team scoring (best 2 of N) | ✅ | Gross and net, running totals |
| Round summary page | ✅ | Gross/net toggle, team rankings |
| Individual leaderboard | ✅ | Avg score, best round, medals |
| Admin toggle (show/hide leaderboard) | ✅ | league_settings table |
| Player profile pages | ✅ | Round history, stats |
| Deploy to Vercel | ✅ | gobs-golf.vercel.app |

---

## Phase 2 — Core Improvements

### Scoring & Rounds

| # | Feature | Status | Priority | Notes |
|---|---|---|---|---|
| 2.1 | Connect admin teams to scorecard flow | 📋 | HIGH | When Thomas pre-makes teams, scorekeepers should land on tee selection, not a blank scorecard. The two paths (admin-created vs. on-the-spot) need to feel like one flow. |
| 2.2 | Score editing after round complete | 📋 | HIGH | Allow fixing typos on completed rounds. Show a clear "Editing completed round" banner so it's obvious. |
| 2.3 | Handicap index bulk update | ❓ | HIGH | Waiting on Dad to send handicap data for all 45 players. When it arrives, batch update the players table. |
| 2.4 | Net score tiebreaker rule | ❓ | LOW | When best 2 net scores tie on a hole, take any 2 (current default). Ask Dad if there's a preferred tiebreaker. |

### Tees

| # | Feature | Status | Priority | Notes |
|---|---|---|---|---|
| 2.5 | Combo tees | ❓ | MEDIUM | Some players may play a mix of tees (e.g., blue front 9, white back 9). Need to understand how this works from Dad before designing. Questions: Which holes switch? Does it affect handicap calc? Is it per-player or a fixed combo? |

---

## Phase 3 — Money & Betting

| # | Feature | Status | Priority | Notes |
|---|---|---|---|---|
| 3.1 | Weekly winners tracking | ❓ | HIGH | Need answers from Dad: How is $10 buy-in split? What triggers payouts? Who wins team money — 1st place only or top 2? Gross or net? |
| 3.2 | Hole In One pot | ❓ | MEDIUM | Accumulating pot, resets on payout. Need: contribution amount per round, payout rules. |
| 3.3 | BFB pot | ❓ | MEDIUM | Need: what BFB stands for, what triggers payout, contribution per round. |
| 3.4 | Auto-calculate winnings from scores | 💡 | HIGH | The goal — once we know the formula, scores go in, money comes out. No manual entry. |
| 3.5 | Season winnings leaderboard | 💡 | MEDIUM | Total won/lost, avg per round, rounds played. Visible to admin (and players if toggled on). |

### Questions for Dad (Money)
1. How does the $10 buy-in get split? (team pot vs. Hole In One pot vs. BFB pot)
2. What does BFB stand for? What triggers the payout?
3. Who wins the team money? Just 1st place? Top 2 teams?
4. Is winning based on gross or net team score?
5. How does the winning team split the pot? Even split?
6. Does the pot carry over if nobody wins (e.g., all teams tie)?

---

## Phase 4 — SWAT

| # | Feature | Status | Priority | Notes |
|---|---|---|---|---|
| 4.1 | SWAT scoring engine | ❓ | UNKNOWN | Need: what SWAT stands for, full rules, how it interacts with regular scoring. |
| 4.2 | SWAT Scramble format | ❓ | UNKNOWN | Need: scramble rules, how teams work in scramble, does it replace regular play or alternate weeks? |

### Questions for Dad (SWAT)
1. What does SWAT stand for?
2. How does SWAT scoring differ from regular best-2-of-4?
3. How often do they play SWAT vs. regular format?
4. What's a SWAT Scramble — different from regular SWAT?

---

## Phase 5 — Admin Tools

| # | Feature | Status | Priority | Notes |
|---|---|---|---|---|
| 5.1 | Played-with matrix | 📋 | MEDIUM | Show how many times each player has been on a team with every other player. The view/table exists in Supabase already (played_with_matrix). Need a UI. |
| 5.2 | Team recommendation engine | 💡 | LOW | Suggest balanced teams based on: handicap spread, played-with history (avoid repeats), maybe random with constraints. |
| 5.3 | Weekly money summary (admin view) | ❓ | MEDIUM | Depends on 3.1 — once money logic exists, show Thomas a per-round breakdown and season totals. |
| 5.4 | Player management | 💡 | LOW | Add/deactivate players, edit handicap indexes, from the admin page instead of Supabase directly. |
| 5.5 | Historical team viewer | 💡 | LOW | Browse past rounds: who was on which team on what date. |

---

## Phase 6 — Player Profile Enhancements

| # | Feature | Status | Priority | Notes |
|---|---|---|---|---|
| 6.1 | Season stats summary | 📋 | MEDIUM | Rounds played, avg gross, avg net, best/worst, scoring trend (improving or not). |
| 6.2 | Performance chart | 💡 | MEDIUM | Line chart of scores over time. Visual trend of improvement. |
| 6.3 | Winnings/losses on profile | ❓ | LOW | Depends on 3.1. Show per-player season money total and per-round history. |
| 6.4 | Played-with stats | 📋 | LOW | Who they've played with most/least. Fun social stat. |
| 6.5 | Head-to-head comparisons | 💡 | LOW | "You and Bill have played together 8 times. Your team's record: 5-3." |

---

## Parking Lot (Not Scoped Yet)

- Custom domain (gobsgolf.com)
- PWA "Add to Home Screen" polish
- Push notifications for round reminders
- Tournament bracket logic
- Historical data import from old spreadsheet (years of past data)
- Handicap calculation engine (beyond simple CH — track differentials, rolling average)
- Multiple courses (if they ever play somewhere besides Semiahmoo)
- Player photos / avatars
- Dark mode

---

## Open Questions for Dad

| # | Question | Category | Status |
|---|---|---|---|
| Q1 | Handicap indexes for all players | Scoring | Sent — waiting |
| Q2 | How does the $10 buy-in get split? | Money | Need to ask |
| Q3 | What does BFB stand for? Payout trigger? | Money | Need to ask |
| Q4 | Who wins team money? 1st only or top 2? | Money | Need to ask |
| Q5 | Gross or net for team money? | Money | Need to ask |
| Q6 | How do winners split the pot? | Money | Need to ask |
| Q7 | What does SWAT stand for? | SWAT | Need to ask |
| Q8 | SWAT scoring rules | SWAT | Need to ask |
| Q9 | How do combo tees work? | Tees | Need to ask |
| Q10 | Tiebreaker preference for best-2 net? | Scoring | Need to ask |
| Q11 | Does pot carry over on ties? | Money | Need to ask |

---

## Session Log

| Date | What got done |
|---|---|
| Apr 21 | Phase 0 complete — accounts, tools, deploy |
| Apr 21-27 | Schema, seed data, core app with Gemini |
| Apr 27 (evening) | Fixed tee/CH bugs, tap-to-select roster, team scoring, leaderboard, admin toggles, round summary, nav cleanup |
