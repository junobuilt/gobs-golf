# GOBS Roadmap — Proposed Changes from May 9 Feedback

This is the diff against the current `ROADMAP.md`. Apply after review.

---

## NEW SECTION — insert near the top, before Phase A

### Phase 0.5 — Live-Test Critical Fixes

*Surfaced from May 8 first-live-course test. Both items are blocking real-round use. Ships before any other Phase work.*

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| LT1 | Course Handicap display mismatch on scorecard | 📋 | DB calculates correct CH per tee (verified: Kevin 12.5 HI → 9 CH white/yellow; Wayne 20.1 → 17). Scorecard displays wrong value (6, 14 respectively). Stroke-allocation dots use the same wrong number. Likely stale snapshot on `round_players` or wrong tee-id in the join. Must fix end-to-end: row CH display, dots logic, engine calls — all read from the same corrected source. |
| LT2 | Scores reverting to par on hole navigation | 📋 | Reproduced live by two independent testers in same round. Enter score, navigate to a later hole, return — score shows par. Suspect A6 first-tap-lands-on-par regression: hole-component re-mount may treat saved score as null and re-trigger the par-anchor on display. Investigation: hydrate-before-render check on hole nav; git blame May 7 PM A6 change. |

**Phase 0.5 exit criteria:** Both bugs unreproducible in a back-to-back live round. Dad's CH for Kevin/Wayne/etc. matches DB on the scorecard. Scores persist across hole nav for all players in a round.

---

## NEW SECTION — insert as Phase A.1 (or fold into existing Phase A as new rows)

### Phase A.1 — Pre-Monday Stableford & Format Cleanup

*Targeted at the next round (Monday May 11) which Dad expects will be Stableford.*

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| A1.1 | Replace Stableford point table with GOBS values | 📋 | New table: Albatross +8, Eagle +5, Birdie +2, Par 0, Bogey −1, Double Bogey or worse −2. Replaces current `STABLEFORD_STANDARD_POINTS`. Behavioral change: par now scores 0 (was 1); a flat-pars round = 0, not 18. Update unit tests + snapshots. |
| A1.2 | Reconcile GOBS House with new Standard table | ❓ | New Standard already does −2 on net DB. Existing GOBS House rule (Standard + −1 deduction for net DB or worse) would now produce −3 at DB. Confirm intent with Dad: keep −3, retire GOBS House, or redefine the deduction. |
| A1.3 | Add Best Ball as 6th format | 📋 | Strict best-1 net per hole, regardless of team size (2/3/4 players). Engine: dispatcher → `computeBestNHole(N=1)`. UI: add to FormatPicker. Net/gross toggle: pin to net (greyed control + "Best Ball is always net" caption). Override-holes section: documented no-op like Stableford. New unit tests + snapshot script. |
| A1.4 | Move format picker into admin Round Setup tab | 📋 | Currently format selection is gated behind scorecard creation. New flow: admin opens Round Setup → "Choose Format" CTA visible from round creation onward → format locks at round level → all subsequent scorecards inherit. Yellow "Waiting for format" banner remains for any team that builds a scorecard pre-format. UI/flow change only, no schema work. |

**Phase A.1 exit criteria:** Stableford rounds score using GOBS values. Best Ball is a real round-creation option. Admin can set format from Round Setup tab without touching a scorecard.

---

## CHANGE — Phase B.2 row B2.3 / B2.4

Replace the existing notes for B2.3 (Stableford Standard) with the new GOBS table values. Or, if user prefers, retire "Stableford Standard" entirely and rename it "GOBS Stableford" since the league's only going to use their custom values anyway.

**Recommendation:** Rename, don't keep two near-identical formats. Reduces decision points for Dad on round setup.

---

## CHANGE — Phase C reordering

**Move Phase D.1 (Blind Draw) ahead of Phase C PR 3 (C4/C5/C6).**

Dad's reasoning: blind draw happens roughly every other round due to typical odd-player counts. Needs real-round testing before more leaderboard polish.

New order:
1. Phase 0.5 (LT1, LT2) — critical bugs
2. Phase A.1 (Stableford + Best Ball + format-picker move)
3. Phase D.1 (Blind Draw — D1.1 through D1.6)
4. Phase C PR 3 (C4 + C5 + C6 — drill-in summary)
5. Phase E onward as previously ordered

---

## DELETE — Phase D.2 (Rainout)

Dad: "If we stop playing, we don't do payouts. Scratch that."

Remove rows D2.1 and D2.2. Remove the Phase D.2 subsection header. Update Phase D exit criteria to mention only blind draw.

---

## DELETE — Phase H.4 (Partial round decision)

Dependent on D.2; same rationale.

---

## DELETE — Open Question Q8

"Partial round (under 9 holes) — discard or save separately?" — answered by deletion of D.2.

---

## NEW ROW — Phase F.2 (Betting tab)

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| F2.X | BFB Fund visibility on home page | 📋 | Surface running BFB total on home page so league sees the charity element. Annual donation drive is in July. Possible future addition: drive-specific tracking, contribution nudges. |

---

## NEW ROW — Phase A (or A.1)

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| A.X1 | F9 / B9 / Total on scorecard team-net pill | 📋 | Three cumulative-net numbers on the big blue pill (F9, B9, Total). Simple numbers, no per-hole breakdown. Drives Nassau bet payouts. Layout test needed at iPhone SE width (375px). |
| A.X2 | Tap player row → expand hole-by-hole | 📋 | On scorecard, tap player row to reveal that player's gross scores per hole, F9 row + B9 row with F9/B9 totals. Same data shape as Phase C drill-in (C4/C5/C6) — bundle the work. |

---

## NEW ROW — Phase H (Pre-launch hardening)

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| H.X | QR code for current URL | 📋 | One-time deliverable. Regenerate when custom domain ships. |
| H.Y | "Add to Home Screen" instructions for Dad | 📋 | Short numbered guide (iOS Safari Share → Add to Home Screen, Android Chrome equivalent). For Dad to forward to league. Doc deliverable, not code. |
| H.Z | DB export for Dad's manual verification | 📋 | One-shot. Export per-player handicap config, per-tee data, hole yardages as screenshots/CSV. Dad will manually verify end-to-end. |

---

## ELEVATE — Phase H.2 (DB backup strategy)

Currently flagged "launch-blocker." Now also blocks **historical data import** (Dad asked May 9 if he could enter all 2026 historical rounds; answer is no until backup + partial-reset workflow is in place).

Suggest changing severity language: from "treated as launch-blocker for full production use" to "treated as blocker for **historical data import and** full production use."

This bumps Phase H.2 sooner in the order — likely should come after Phase A.1 / Phase D.1, before Phase E.

---

## ANSWER — Open Questions

Q1, Q2-Q7 (payout): being worked by another Claude instance, out of scope for this session.

Q8: deleted (rainout cancelled).

**Add to Open Questions:**
- New Q: GOBS House format viability with revised Stableford table — keep, retire, or redefine?
- New Q: Best Ball + override holes — confirm no-op behavior like Stableford?

---

## NEW DECISIONS LOCKED

Add to "Decisions Locked" section:

### Stableford point values (locked May 9, 2026)

GOBS-specific table replaces Stableford Standard:
- Albatross: +8
- Eagle: +5
- Birdie: +2
- Par: 0
- Bogey: −1
- Double Bogey or worse: −2

Implication: par-flat round scores 0, not 18. Negative-going points possible for individual holes. Affects all leaderboard math, snapshot baselines, and historical Stableford rounds (if any exist post-deployment).

### Best Ball format (locked May 9, 2026)

- **Selection rule:** Strict best-1 — exactly one player's score counts per hole, regardless of team size.
- **Scoring basis:** Net only. The format's purpose is handicap equalization; gross best ball undermines the equalizer in a mixed-handicap league. Net/gross toggle is disabled for this format.
- **Engine:** `computeBestNHole` with N=1 via dispatcher.

### Rainout / partial rounds (locked May 9, 2026)

League rule: if play stops, no payouts, round doesn't count. No app-side partial-round handling needed. Phase D.2 deleted.

### Non-paying player handling (locked May 9, 2026)

Players who opt out of betting are not put on a scorecard. Their team plays as a blind-draw team. No app-side toggle needed for "exclude from betting but keep scoring."

### Format selection entry point (locked May 9, 2026)

Format chosen by admin on Round Setup tab, before any scorecard exists. Earlier flow (format-after-scorecard) deprecated.

---

## SESSION LOG ENTRY (draft)

| May 9 | First live-course feedback session. Phone consultation with Dad covering May 8 round. Two critical bugs identified: scorecard CH displaying wrong values vs DB (Kevin/Wayne examples confirmed live), and scores reverting to par on hole navigation (reproduced by two testers same round). New Phase 0.5 created for these. Stableford point table being replaced with GOBS-specific values (Albatross/Eagle/Birdie/Par/Bogey/DB = +8/+5/+2/0/−1/−2) ahead of expected Monday Stableford round. Best Ball added as 6th format, locked to net-only with strict best-1 selection. Format picker entry point moving from scorecard-gated to admin Round Setup tab to match Dad's actual workflow (admin picks format before pairings are drawn). Blind Draw work (Phase D.1) reprioritized ahead of Phase C PR 3 per Dad's request. Phase D.2 (rainout) deleted — league doesn't pay out on partial rounds, no app-side handling needed. Phase H.2 (DB backup) elevated: now also gates historical data import. New scorecard items: F9/B9/Total on team-net pill (Nassau bets), tap-player-row expand hole-by-hole. New Phase H deliverables: QR code, Add-to-Home-Screen instructions, one-shot DB export for Dad's manual verification. BFB fund visibility on home page added to Phase F.2. Open questions added: GOBS House viability under new Stableford table; Best Ball + override-holes no-op confirmation. |
