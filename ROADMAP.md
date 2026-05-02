# GOBS Golf — Feature Roadmap

*Last updated: May 1, 2026*

---

## How to use this file

* ✅ Done — shipped and working
* 🔨 In Progress — actively being built
* 📋 Ready — spec is clear, can be built anytime
* ❓ Blocked — needs info from Dad or a decision
* 💡 Idea — parked for later, needs scoping

---

## MVP (Shipped)

| Feature | Status | Notes |
| --- | --- | --- |
| Player roster (52 players) | ✅ | Updated May 1 — 7 new players added |
| Handicap indexes (most players) | ✅ | 46 of 52 players have HC data |
| Course/tees/holes data (Semiahmoo) | ✅ | Blue, White, Yellow, White/Yellow Combo tees |
| Yellow tee yardages corrected | ✅ | 5 holes corrected May 1 from dad's scorecard |
| Admin team builder | ✅ | Thomas can pre-make teams |
| Start a Scorecard (tap-to-select) | ✅ | On-the-spot team creation |
| Tee selection with CH calculation | ✅ | Per-player, per-tee |
| Hole-by-hole score entry | ✅ | +/- buttons, hole nav dots |
| Team scoring (best 2 of N) | ✅ | Gross and net, running totals |
| 2-ball indicator on scorecard | ✅ | Ball 1/Ball 2 badges, tap to override |
| Tie handling on scorecard | ✅ | Tied badge only when 3+ players share same score (fixed May 1) |
| Round summary page | ✅ | Gross/net toggle, team rankings |
| Individual leaderboard | ✅ | Avg score, best round, medals |
| Player profile pages | ✅ | Round history, stats |
| Deploy to Vercel | ✅ | [gobs-golf.vercel.app](http://gobs-golf.vercel.app) |
| Admin panel redesign | 🔨 | Navy/green design system, three-state flow in progress |
| Admin toggles (leaderboard, winners, 2-ball) | 🔨 | Moved to Settings tab only, toggle bug fixed |
| Date picker defaults to today | ✅ | UTC timezone bug fixed May 1 |
| Players tab — mobile layout | 🔨 | Card-row layout for mobile in progress |
| Played-with matrix UI | ✅ | Desktop heatmap + mobile search view |
| Historical team viewer (History tab) | ✅ | Browse past rounds by date |
| Player management (add/deactivate/edit HC) | ✅ | From admin Players tab |
| 2025 win/loss data imported | ✅ | Money tracker infrastructure ready |

---

## Phase 2 — Core Improvements

### Scoring & Rounds

| # | Feature | Status | Priority | Notes |
| --- | --- | --- | --- | --- |
| 2.1 | Admin three-state flow | 🔨 | HIGH | State 1: no round. State 2: active scorecards view. State 3: edit mode. Suggest Teams removed for now. |
| 2.2 | Score editing after round complete | 📋 | HIGH | Allow fixing typos on completed rounds. Dangerous-action pattern — "editing completed round" banner. |
| 2.3 | Handicap index bulk update | ✅ | HIGH | Done May 1 — 46 players updated. 4 still need data from Dad: Gary Tobian, Gerry Heys, Norm Cavanagh, DeWaal Smith. |
| 2.4 | Net score tiebreaker rule | ❓ | LOW | Ask Dad if there's a preferred tiebreaker when two players tie for Ball 2. |
| 2.5 | Remove player from round mid-game | 📋 | MEDIUM | Player leaves early. Tap player chip on scorecard → "Remove from round." Scores up to that hole preserved, don't count toward team totals going forward. |
| 2.6 | End round early | 📋 | MEDIUM | Dangerous-action modal. Partial scores saved, round marked incomplete, excluded from standings. |
| 2.7 | Round status accuracy | 🔨 | HIGH | "Complete" only when ALL scorecards for that date are submitted. Otherwise "In Progress." |
| 2.8 | Homepage scorecard visibility | 📋 | MEDIUM | Today's scorecards only on homepage. Yesterday's stay if still in-progress. Older rounds → History only. |
| 2.9 | Individual player rankings on round summary | 📋 | LOW | Table below team scores showing all players ranked by gross score for the day across all teams. |

### Tees

| # | Feature | Status | Priority | Notes |
| --- | --- | --- | --- | --- |
| 2.10 | White/Yellow Combo tee | ✅ | MEDIUM | Added as tee option. Using estimated rating 67.6 / slope 120 until official number obtained from pro shop. |
| 2.11 | Combo tee official rating | ❓ | LOW | Need official course rating and slope for White/Yellow Combo from Semiahmoo pro shop scorecard. |

---

## Phase 3 — Money & Betting

| # | Feature | Status | Priority | Notes |
| --- | --- | --- | --- | --- |
| 3.1 | Weekly winners tracking | ❓ | HIGH | Need answers from Dad — see questions below. Infrastructure built, formula TBD. |
| 3.2 | Hole In One pot | ❓ | MEDIUM | Accumulating pot visible in money tracker. Payout rules TBD. |
| 3.3 | BFB pot | ❓ | MEDIUM | Need: what BFB stands for, what triggers payout, contribution per round. |
| 3.4 | Auto-calculate winnings from scores | 💡 | HIGH | Once formula confirmed, scores go in, money comes out. No manual entry. |
| 3.5 | Season winnings leaderboard | 💡 | MEDIUM | Total won/lost, avg per round, rounds played. Admin view + optional player view. |
| 3.6 | Default buy-in | ✅ | HIGH | $10 per player per round, auto-applied to all players on submitted scorecards. Configurable in Settings. |
| 3.7 | Historical 2025 win/loss import | ✅ | MEDIUM | 2025 per-round win/loss data imported from spreadsheet. |

### Questions for Dad (Money)

1. How does the $10 buy-in get split? (team pot vs. Hole In One pot vs. BFB pot — exact dollar amounts)
2. What does BFB stand for? What triggers the payout?
3. Who wins the team money? Just 1st place? Top 2 teams?
4. Is winning based on gross or net team score?
5. How does the winning team split the pot? Even split among players?
6. Does the pot carry over if nobody wins (e.g., all teams tie)?
7. What happens to a player's buy-in if they leave mid-round?
8. Do guests buy in the same as members?

---

## Phase 4 — SWAT

| # | Feature | Status | Priority | Notes |
| --- | --- | --- | --- | --- |
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
| --- | --- | --- | --- | --- |
| 5.1 | Played-with matrix | ✅ | MEDIUM | Desktop heatmap + mobile player-search view. Data from played_with_matrix table. |
| 5.2 | Team recommendation engine | 💡 | LOW | Shelved — will revisit after smoke testing. Suggest balanced teams based on HC spread + played-with history. |
| 5.3 | Weekly money summary (admin view) | ❓ | MEDIUM | Depends on 3.1. Per-round breakdown and season totals for Thomas. |
| 5.4 | Player management | ✅ | MEDIUM | Add/deactivate/reactivate players, edit HC indexes from admin Players tab. |
| 5.5 | Historical team viewer | ✅ | LOW | History tab — browse past rounds, who was on which team on what date. |
| 5.6 | Admin three-state round flow | 🔨 | HIGH | See 2.1. No round → active view → edit mode. Autosave + undo toast. |
| 5.7 | Dangerous action pattern | ✅ | HIGH | Consistent modal pattern across app: deactivate, edit completed round, end round early, move player, change HC/tee mid-round. |

---

## Phase 6 — Player Profile Enhancements

| # | Feature | Status | Priority | Notes |
| --- | --- | --- | --- | --- |
| 6.1 | Season stats summary | 📋 | MEDIUM | Rounds played, avg gross, avg net, best/worst, scoring trend. |
| 6.2 | Performance chart | 💡 | MEDIUM | Line chart of scores over time. |
| 6.3 | Winnings/losses on profile | ❓ | LOW | Depends on 3.1. Per-player season money total and per-round history. |
| 6.4 | Played-with stats | 📋 | LOW | Who they've played with most/least. |
| 6.5 | Head-to-head comparisons | 💡 | LOW | "You and Bill have played together 8 times. Your team's record: 5-3." |

---

## Open Questions for Dad

| # | Question | Category | Status |
| --- | --- | --- | --- |
| Q1 | HC for Gary Tobian | Scoring | Need to ask |
| Q2 | HC for Gerry Heys | Scoring | Need to ask |
| Q3 | HC for Norm Cavanagh | Scoring | Need to ask |
| Q4 | HC for DeWaal Smith | Scoring | Need to ask |
| Q5 | How does the $10 buy-in get split? | Money | Need to ask |
| Q6 | What does BFB stand for? Payout trigger? | Money | Need to ask |
| Q7 | Who wins team money? 1st only or top 2? | Money | Need to ask |
| Q8 | Gross or net for team money? | Money | Need to ask |
| Q9 | How do winners split the pot? | Money | Need to ask |
| Q10 | Does pot carry over on ties? | Money | Need to ask |
| Q11 | What happens to buy-in if player leaves mid-round? | Money | Need to ask |
| Q12 | Do guests buy in same as members? | Money | Need to ask |
| Q13 | What does SWAT stand for? | SWAT | Need to ask |
| Q14 | SWAT scoring rules | SWAT | Need to ask |
| Q15 | How often SWAT vs. regular format? | SWAT | Need to ask |
| Q16 | What is a SWAT Scramble? | SWAT | Need to ask |
| Q17 | Official course rating + slope for White/Yellow Combo tee | Tees | Need to ask pro shop |
| Q18 | Tiebreaker preference for best-2 net ties | Scoring | Need to ask |
| Q19 | Do they ever play 9 holes instead of 18? | Format | Need to ask |
| Q20 | Do they ever do shotgun starts? | Format | Need to ask |
| Q21 | What defines a season — calendar year or manual? | Scoring | Need to ask |

---

## Open Design / Technical Decisions

| # | Decision | Status |
| --- | --- | --- |
| D1 | Admin access protection — URL-only vs. real login | Undecided |
| D2 | Can non-admin scorekeepers edit scores after submission? | Undecided |
| D3 | Historical data import — import all past seasons or start fresh? | Undecided |
| D4 | Leaderboard scope — all-time vs. current season vs. toggle | Undecided |
| D5 | Deactivated players — show or hide in played-with matrix and history? | Undecided |
| D6 | Homepage scorecard persistence window — 24hrs after round date? | Undecided |
| D7 | If player removed mid-round, do partial scores count toward team total? | Decided: no, scores preserved but excluded from team totals going forward |
| D8 | Recommendation engine team balancing — HC, played-with, or both? | Undecided — shelved |
| D9 | Maximum team size enforcement | Undecided |

---

## Parking Lot (Not Scoped Yet)

* Custom domain ([gobsgolf.com](http://gobsgolf.com))
* PWA "Add to Home Screen" polish
* Push notifications for round reminders
* Tournament bracket logic
* Handicap calculation engine (beyond simple CH — track differentials, rolling average)
* Multiple courses (if they ever play somewhere besides Semiahmoo)
* Player photos / avatars
* Dark mode
* Season start/end controls for admin

---

## Session Log

| Date | What got done |
| --- | --- |
| Apr 21 | Phase 0 complete — accounts, tools, deploy |
| Apr 21-27 | Schema, seed data, core app with Gemini |
| Apr 27 (evening) | Fixed tee/CH bugs, tap-to-select roster, team scoring, leaderboard, admin toggles, round summary, nav cleanup |
| May 1 | Admin panel redesign (navy/green design system), 2-ball indicator, tie handling, dangerous action pattern, played-with matrix, history tab, player management, 7 new players added, 46 HC indexes updated, Yellow tee yardages corrected, White/Yellow Combo tee added, date picker UTC bug fixed, toggle double-fire bug fixed, Claude Code workflow established |
