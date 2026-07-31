# GOBS Ryder Cup — Tournament Test Playbook (REAL players)

A scripted, hole-by-hole dress rehearsal you run like Dad would: create a tournament, set teams, play all three days, and verify the numbers at each checkpoint. Uses **real league players and real handicaps**, so it also tests the **Handicap Index → Course Handicap** conversion.

> **Note (2026-07-31):** committed to the repo as the source-of-truth rules/test reference. One arithmetic correction vs. the working draft — the Day-3 **S3** running total is **USA 5** after a USA win (not "4½"); the 4½ is the *win line* USA crosses during S3, not the resulting total. Everything else is unchanged.

**First, the HI vs CH thing (important):** the roster below lists each player's **Handicap Index (HI)** — the portable USGA number. The app converts that to a **Course Handicap (CH)** for Semiahmoo (via slope/rating). **Match-play strokes and the greensomes math all use CH, not HI.** So when you verify a handicap number, you: (1) read the **CH the app shows** for each player, (2) check the formula against *that*. Don't expect the HI to equal the CH.

**How many players:** 10 is plenty. Scale doesn't test the logic; hand-checkable math does.

---

## Roster — assign these 10 real players

| Player | Home side | HI | Role |
| :---- | :---- | :---- | :---- |
| Terry M | USA | 8.4 |  |
| Don W | USA | 10.9 |  |
| Kevin I | USA | 12.6 |  |
| Chuck B | USA | 13.2 |  |
| **Thomas Y** | USA | 15.8 | **ALTERNATE → plays Canada on Day 2** |
| Dan G | Canada | 14.3 |  |
| Hunter L | Canada | 18.4 |  |
| Bob P | Canada | 22.0 |  |
| Dave V | Canada | 24.0 |  |
| Bill T | Canada | 26.8 |  |

**Thomas Y is the alternate** — USA on Days 1 & 3, **Canada on Day 2**. That's the per-day-side test.

---

## Phase 0 — Create the tournament (Dad's fresh setup)

- [ ] Admin → Tournament → **create a NEW test tournament** (fresh — this also tests the create-from-scratch flow Dad will actually run). Don't delete anything (deletion gate).  
- [ ] **Side A \= USA, Side B \= Canada**; **"Who holds the cup?" \= Canada.**  
- [ ] Add the 10 players above as participants; assign home sides on the **SIDES** screen (USA / Canada buttons).  
- [ ] Confirm 3 days: **Day 1 Greensomes · Day 2 Best Ball (four-ball) · Day 3 Singles.**  
- [ ] Leave it **Test** for now.

**CHECK (cup holder):** open the Scoreboard → **EXPECT** 🏆 **Canada holds the cup**, and once all 8 matches exist, **4½ to win (USA) / 4 to retain (Canada)**.

> **Note on the alternate control:** it is NOT on this global SIDES screen (that only sets home side). The per-day override lives on the **Pairings** screen for each day — you'll use it on Day 2\. *(If it turns out there's no per-day control on the Day-2 Pairings screen either, that's a real bug — log it.)*

---

## Read the Course Handicaps first (do this once, write them down)

Before scoring, open a pairing/scorecard and **note the Course Handicap (CH) the app shows for each of the 10 players.** You'll verify all the handicap math against these.

| Player | HI | CH (from app) |
| :---- | :---- | :---- |
| Terry M | 8.4 | \_\_\_ |
| Don W | 10.9 | \_\_\_ |
| Kevin I | 12.6 | \_\_\_ |
| Chuck B | 13.2 | \_\_\_ |
| Thomas Y | 15.8 | \_\_\_ |
| Dan G | 14.3 | \_\_\_ |
| Hunter L | 18.4 | \_\_\_ |
| Bob P | 22.0 | \_\_\_ |
| Dave V | 24.0 | \_\_\_ |
| Bill T | 26.8 | \_\_\_ |

---

## Global cross-surface check

Whenever you see "**CHECK cross-surface**," open the **Scoreboard**, the **Homepage**, and the **Scorecard** and confirm the value is **identical**. They can't legitimately disagree — if they do, log it.

---

# DAY 1 — GREENSOMES (2 matches)

### Pairings

- **1A (SHOTGUN — start hole 15, Group A):** USA **Terry M \+ Don W** vs Canada **Dan G \+ Hunter L**  
- **1B (normal start, Group B):** USA **Chuck B \+ Kevin I** vs Canada **Bob P \+ Bill T**

>   
> Set 1A's **start hole \= 15** in the group builder — that's the shotgun test.

### Verify greensomes team handicap (formula: round(0.6 × lower CH \+ 0.4 × higher CH))

Using the **CH values you wrote down** (not HI):

- [ ] **1A USA** \= round(0.6 × \[lower of Terry/Don's CH\] \+ 0.4 × \[higher\]). **1A Canada** \= same with Dan G / Hunter L. The lower team plays scratch; the higher gets the difference in strokes.  
- [ ] **1B** \= same formula for Chuck+Kevin vs Bob P+Bill T.  
- **If the team handicap the app shows ≠ your formula result on the displayed CHs, log it — this is Day 1's scoring basis.**

### Match 1A — shotgun \+ walk-off

- Open 1A. **CHECK (shotgun):** hole rail **starts at 15** and rotates 15→16→17→18→1→2… Entering hole 15 first raises **no "skipped holes" warning.**  
- **Enter:** USA team gross **4** every hole; Canada team gross **7** every hole (3-shot cushion beats any stroke).  
- After \~5 holes: **CHECK cross-surface** — all show **USA X UP · thru 5**.  
- Keep going. **EXPECT:** match **closes automatically** once USA's lead exceeds holes left (remaining holes no longer required) → **"USA wins X & Y"** → **USA \+1 point.**

### Match 1B — full 18, halved match

- Normal start. **Enter (front/back split):** holes 1–9 USA gross **4** / Canada **6**; holes 10–18 Canada **4** / USA **6**.  
- Watch the lead swing; watch for **"Dormie"** if a side is ever up by exactly the holes left.  
- **EXPECT:** goes all 18, ends **All Square → Halved → ½ point each.** (Must read "**All Square**," not "AS" or "Tied".)

### Edge case — OVERRIDE (after 1A closes)

- [ ] Admin → **Results & overrides.** **CHECK copy:** "Use this panel to override scores/results — changes override the scoring engine."  
- [ ] Force **1A → Canada.** **EXPECT** scoreboard flips. Then **revert** → back to USA.

### End of Day 1

- [ ] **EXPECT: USA 1½ – Canada ½.** 2 of 8 decided. Canada still holds the cup. **CHECK cross-surface.**

---

# DAY 2 — BEST BALL / FOUR-BALL (2 matches) \+ ALTERNATE (Thomas Y → Canada)

### Alternate test (FIRST)

- [ ] On the **Day-2 Pairings** screen, set **Thomas Y's side \= Canada** for this day. **EXPECT** he's tagged **"Canada today · alternate (home USA)."** *(This is also where you confirm the per-day control exists — the thing missing from the global SIDES screen.)*  
- [ ] Build the Day-2 groups with Thomas on Canada.  
- [ ] **Freeze warning:** after a group with Thomas is built, try to change his side again → **EXPECT** a warning it **won't re-side an already-built match** (rebuild needed). Correct behavior — confirm it fires.

### Pairings

- **2A:** USA **Terry M \+ Kevin I** vs Canada **Dan G \+ Thomas Y (alt)**  
- **2B:** USA **Don W \+ Chuck B** vs Canada **Hunter L \+ Bob P**

### Verify four-ball handicaps (everyone off the LOWEST CH in the match)

- [ ] **2A:** lowest CH of the four → that player 0; each other \= their CH − lowest. Verify the app's stroke numbers match.  
- [ ] **2B:** same.

### Match 2A — best-NET-ball selection (key four-ball test)

- **Best-of-two:** make the two USA players score very differently (one great, one poor) and confirm the app counts the **better** one; same for Canada. **CHECK** the app marks the **counting ball**.  
- **NET beats gross:** on a hole where a high-CH player (e.g. Thomas Y) **gets a stroke** (dots), give him a higher gross but lower **net** than his partner → **EXPECT** the app counts his ball **by net, not gross.**  
- Finish so **Canada wins 2A** (goes to 18, no walk-off) → Canada **\+1.**

### Match 2B — USA win

- Give USA a 2-shot cushion on enough holes → **USA \+1.**

### End of Day 2

- [ ] **EXPECT: USA 2½ – Canada 1½.** 4 of 8 decided. Confirm **Thomas Y scored for Canada.** **CHECK cross-surface.**

---

# DAY 3 — SINGLES (4 matches)

### Alternate returns home

- [ ] Confirm **Thomas Y is USA again on Day 3** automatically (no override → home fallback).

### 1v1-split test (FIRST)

- [ ] Open a Day-3 foursome pairing. **EXPECT** it opens as **two separate 1-on-1 scorecards** (2 players each), NOT one 4-player card.

### Pairings (off the lower CH, 1v1)

- **S1:** Terry M (USA) v Dan G (Canada)  
- **S2:** Don W (USA) v Hunter L (Canada)  
- **S3:** Chuck B (USA) v Bob P (Canada)  
- **S4:** Thomas Y (USA) v Bill T (Canada)

### S1 — singles walk-off

- **Enter:** Terry gross **4**, Dan G gross **7** every hole → Terry wins every hole → **closes early** (walk-off) → **USA \+1 → running USA 3½.**

### S2 — dormie → halve \+ stroke check

- **Stroke check:** Hunter L (higher CH) gets strokes. On a Hunter stroke-hole (dots), enter **tied gross (both 5\)** → **EXPECT Hunter wins the hole** (net 4 vs 5). *If tied gross on a stroke hole does NOT go to the receiver, that's a bug.*  
- **Dormie:** get Don W **2 UP with 2 to play** → **EXPECT "Dormie"** shows. Then Hunter wins the last 2 → **All Square → Halved → ½ each.**  
- Running after S2: **USA 4 – Canada 2\.**

### S3 — the CLINCH

- **Enter:** Chuck B gross **4**, Bob P gross **7** → Chuck wins → **USA \+1 → USA 5.0** (crossing the 4½ win line).  
- **EXPECT: the instant USA crosses 4½, the bar crosses the gold line and shows USA has WON the cup** — even with S4 still live. Running score reads **USA 5 – Canada 2\.** **CHECK cross-surface.**

### S4 — recorded even though decided

- **Enter:** Bill T gross **4**, Thomas Y gross **7** → **Canada \+1.**  
- **EXPECT final: USA 5 – Canada 3\.** All 8 decided.

### Variant — RETAIN-on-tie (optional, \~5 min)

- Re-run/override so **S3 is a Canada win** instead → final **USA 4 – Canada 4** → **EXPECT Canada RETAINS the cup** (holder keeps it on a tie), not USA winning. Tests holder \+ dynamic threshold.

---

# Cross-cutting edge cases (anytime)

- [ ] **Card-split guard** (needs tournament **Live** — do at go-live): create a regular league round while Live → **EXPECT** a warning it won't count → the cup total does NOT move.  
- [ ] **Not-started / live / final** card states all look right.  
- [ ] **Find your match** shortcut lands on the right scorecard.  
- [ ] **Leaderboard nav** → Scoreboard when Live.  
- [ ] **Mobile:** run at least one full match on your **phone** (Dad's device) — taps, scroll to bottom, steppers.  
- [ ] **Pre-score group edit:** before scoring, swap a player in the builder → updates cleanly. *(Swapping AFTER scores is NOT built — don't rely on it.)*

---

# Known NOT in this release (not bugs)

Day soft-lock · post-score player swap · Oswald font (using Inter). Also: the built UI lost some design fidelity vs the mock — parked design-polish pass, not a bug.

---

# Rules reference (source of truth for handicap math)

- **Greensomes team handicap (Day 1):** `round(0.6 × lower CH + 0.4 × higher CH)`. Lower-handicap team plays scratch; the other gets the difference.  
- **Four-ball / best ball (Day 2):** all four play off the **lowest CH in the match**; each other player gets `their CH − lowest`. Team's hole result \= the **lower NET** of its two balls.  
- **Singles (Day 3):** off the **lower CH** of the two; higher-CH player gets the difference.  
- **Match play scoring:** win a hole \= 1, tie \= ½. Win the 18-hole match \= **1 cup point**; halved match \= **½ each**.  
- **Cup thresholds (dynamic, from match count N):** win line \= `N/2 + 0.5`; retain line \= `N/2`. Holder **retains on an exact tie**. Challenger must reach the win line to take the cup.

---

# Bug log

| \# | Where | What you did | Expected | Got | Severity |
| :---- | :---- | :---- | :---- | :---- | :---- |
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |
| 4 |  |  |  |  |  |
| 5 |  |  |  |  |  |

