# GOBS Payout Engine — Logic Specification

**Status:** Locked, ready for implementation
**Version:** v3 (cascade balancing)
**Last updated:** 2026-05-31

This document defines the deterministic logic for calculating team payouts at the end of a GOBS round. It is the canonical reference for the engine. UI behavior, persistence, and admin overrides are out of scope.

---

## 1. Purpose

Replace the manual, gut-feel spreadsheet currently used to distribute the team pot. The engine takes three inputs (number of players, team size, balance) and returns deterministic per-player payouts for 1st–4th place teams plus a BFB sweep amount.

## 2. Inputs

| Name | Type | Range | Description |
|---|---|---|---|
| `players` | integer | ≥ 2 | Total paying players in the round |
| `team_size` | integer | 2, 3, or 4 | Players per scorecard |
| `balance` | integer (dollars) | ≥ 0 | Pot remaining after HIO ($1/player) and BFB ($2/player) contributions are deducted from the $10/player buy-in |

Derived: `num_teams = floor(players / team_size)`. If `players` does not divide evenly, the remainder are non-paying or part of an incomplete team and do not affect the engine.

## 3. Outputs

```
{
  places_paid: 1 | 2 | 3 | 4,
  per_player: [int, int?, int?, int?],   // 1st through Nth place, per-player payout in whole dollars
  total_paid: int,                        // sum of per_player[i] * team_size across all places
  bfb_sweep: int                          // balance - total_paid, always ≥ 0
}
```

Each `per_player[i]` is the dollar amount each individual player on that placing team receives. Total team payout for place `i` is `per_player[i] * team_size`.

## 4. Constants

```
CAP_PER_PLAYER = 25      // HARD — 1st place never exceeds this
FLOOR_PER_PLAYER = 5     // HARD — every paid place must be ≥ this
GAP_PRIMARY = 3          // SOFT — preferred minimum between consecutive places
GAP_FALLBACK = 1         // SOFT — absolute minimum (never tie)
```

## 5. Starting Proportions

These are the *starting shape* applied to the balance. The engine may deviate from them to honor hard rules (see Section 7).

| Places Paid | Per-team share of balance |
|---|---|
| 1 | 100% |
| 2 | 65 / 35 |
| 3 | 55 / 30 / 15 |
| 4 | 50 / 25 / 17 / 8 |

## 6. Rule Hierarchy

Rules are categorized by strictness. The engine never violates a HARD rule.

**HARD rules (never violated):**
1. **Cap:** 1st place per-player ≤ $25
2. **Pay max places possible:** dropping a place is the absolute last resort
3. **Floor:** every paid place is ≥ $5/player
4. **Non-negative:** no place pays less than $0/player

**SOFT rules (may be relaxed):**
5. **Gap:** preferred $3 between consecutive places; may shrink to $1
6. **Proportions:** starting shape only; engine deviates as needed

## 7. Algorithm

### Step 1 — Determine target places paid

```
if num_teams < 2:    no payout (return empty)
if num_teams == 2:   target_places = 1
if num_teams == 3:   target_places = 2
if num_teams in [4, 5]:   target_places = 3
if num_teams >= 6:   target_places = 4
```

### Step 2 — Try to produce a valid payout

Loop from `places = target_places` down to 1. For each `places` count, try `gap` values in order `[3, 2, 1]`. Use the first combination that produces a valid result.

For each `(places, gap)` attempt, call the `build(places, gap)` sub-routine (Section 8). If it returns a valid result, accept it. Otherwise, try the next combination.

**Critical:** Dropping a place is allowed only after all gap values (3, 2, 1) have been tried at the current `places` count.

### Step 3 — Spread leftover dollars

After Step 2 produces a valid payout, calculate `leftover = balance - sum(per_player[i] * team_size for i in places)`.

Distribute leftover one $1/player at a time, walking 1st → last in repeated passes:

```
while leftover >= team_size:
  spread_happened = False
  for i in range(places):
    if leftover < team_size: break
    if per_player[i] + 1 > CAP: continue          // skip capped teams
    if i > 0 and per_player[i] + 1 > per_player[i-1] - gap: continue  // skip if gap violated
    per_player[i] += 1
    leftover -= team_size
    spread_happened = True
  if not spread_happened: break
```

Run this twice: once with `gap = 3`, then once with `gap = 1` if leftover ≥ team_size remains.

### Step 4 — Return result

```
total_paid = sum(per_player[i] * team_size for i in places)
bfb_sweep = balance - total_paid
```

## 8. `build(places, gap)` Sub-routine

This is the core of cascade balancing. Returns a valid `per_player` array of length `places`, or `None` if no valid arrangement exists at this `(places, gap)`.

### 8a. Apply proportions

```
per_player = [floor(balance * proportions[places][i] / team_size) for i in range(places)]
```

### 8b. Apply cap with proportional redistribution

If `per_player[0] > CAP`:

```
overflow_team_dollars = (per_player[0] - CAP) * team_size
per_player[0] = CAP
remaining_props = proportions[places][1:]
remaining_sum = sum(remaining_props)
for i from 1 to places-1:
  share = remaining_props[i-1] / remaining_sum
  bonus_per_player = floor((overflow_team_dollars * share) / team_size)
  per_player[i] += bonus_per_player
```

### 8c. Apply gap (initial enforcement)

```
for i from 1 to places-1:
  if per_player[i] > per_player[i-1] - gap:
    per_player[i] = per_player[i-1] - gap
  if per_player[i] < 0:
    per_player[i] = 0
```

### 8d. Cascade balancing — raise sub-floor places

While any `per_player[i]` for `i in [1, places-1]` is below `FLOOR`:

Identify the lowest-indexed place below floor: `target = max(i for i in range(1, places) if per_player[i] < FLOOR)`.

To raise `per_player[target]` by 1, one of these must hold:

**Case A:** `per_player[target] + 1` does not violate the gap with `per_player[target-1]`.
  → Pull $1 from `per_player[0]` if `per_player[0] - 1 >= per_player[1] + gap`.
  → Otherwise, try pulling from an intermediate place `i in (1, target)` where `per_player[i] - 1 >= per_player[i+1] + gap`.
  → If neither is possible: return `None`.

**Case B:** `per_player[target] + 1` would violate the gap with `per_player[target-1]`.
  → First raise `per_player[target-1]` by 1 (recursively, with the same rules), then retry.

If a guard of 200 iterations is reached without convergence, return `None`.

### 8e. Final validation

Return `None` if any of:
- `per_player[0] > CAP`
- Any `per_player[i] < FLOOR` for `i >= 0` (note: 1st place is also subject to floor, but cap dominates in practice)
- Any `per_player[i] > per_player[i-1] - gap` for `i >= 1`
- Any `per_player[i] < 0`

Otherwise, return the array.

## 9. Edge Cases

| Scenario | Behavior |
|---|---|
| `num_teams < 2` | Return empty result; no payout |
| `balance == 0` | All per-player = 0; sweep = 0 |
| `num_teams == 2` (only 1 place to pay) | 1st gets `min(floor(balance / team_size), CAP)`; leftover sweeps to BFB |
| Maximum compression (e.g., 30 plyrs / 2-per-team) | All 4 places packed against cap with $1 gap; remainder sweeps to BFB. This is intentional — the cap is doing its job |
| Cannot satisfy floor at any `(places, gap)` | Drop to `places - 1` and retry. Last resort: 1 place gets capped amount, remainder to BFB |

## 10. Worked Examples

### Example A — small pot, clean fit
- Input: `players=8, team_size=2, balance=56`
- num_teams=4 → target_places=3
- Proportions 55/30/15 → [$15, $8, $4]
- Floor check: 3rd is $4, below floor of $5
- Cascade: pull $1 from 1st, give to 3rd → [$14, $8, $5] ✓
- Step 3 leftover spread: $2 remains ($56 − $54); one $1/player pass lifts 1st → [$15, $8, $5], no leftover
- **Output:** `places_paid=3, per_player=[15, 8, 5], total_paid=56, bfb_sweep=0`
- *Corrected 2026-06-07 — prior values skipped the Rule 6 leftover-spread step; golden.csv is the source of truth.*

### Example B — cap activates, leftover spreads
- Input: `players=22, team_size=2, balance=154`
- num_teams=11 → target_places=4
- Proportions 50/25/17/8 → [$38, $19, $13, $6]
- Cap: 1st > $25 → cap to $25, redistribute overflow → [$25, $25, $17, $8]
- Gap enforcement (gap=3): [$25, $22, $17, $8]; floor passes
- Leftover spread fills capacity ($10 leftover, two passes): [$25, $22, $19, $11]
- **Output:** `places_paid=4, per_player=[25, 22, 19, 11], total_paid=154, bfb_sweep=0`
- *Corrected 2026-06-07 — prior values skipped the Rule 6 leftover-spread step; golden.csv is the source of truth.*

### Example C — maximum compression
- Input: `players=30, team_size=2, balance=210`
- num_teams=15 → target_places=4
- Proportions → cap → balance → results in [$25, $24, $23, $22] (gap relaxes to $1)
- Cannot pay more; all 4 places at cap-adjacent values
- **Output:** `places_paid=4, per_player=[25, 24, 23, 22], total_paid=188, bfb_sweep=22`

### Example D — sub-floor requires cascade
- Input: `players=24, team_size=4, balance=168`
- num_teams=6 → target_places=4
- Proportions 50/25/17/8 → [$21, $10, $7, $3]
- Floor check: 4th is $3, below floor
- Cascade: pull $1 from 1st to 4th → [$20, $10, $7, $4]. Still below floor.
- Pull $1 from 1st to 4th → [$19, $10, $7, $5] ✓
- But now gap check: 3rd-to-4th gap is $2, below preferred $3. Acceptable per rule hierarchy.
- Wait — retry at `gap=3`: would require [$x, $10, $8, $5] where $x ≥ $13. Pulling 1st from $21 → $13 gives team total $52 → leftover $116, but proportions break entirely. With gap=3 the engine recurses further:
  - Lift 3rd: pull $1 from 1st → [$20, $10, $8, $5] ✓ all gaps ≥ 3
  - Continue cascading
- Final result after spread: [$18, $11, $8, $5]
- **Output:** `places_paid=4, per_player=[18, 11, 8, 5], total_paid=168, bfb_sweep=0`

## 11. Reference Implementation Behavior

A correct implementation, given the inputs in the [Payout Comparison spreadsheet](GOBS_payout_comparison_v3.xlsx) (V3 rows, purple), must produce identical per-player payouts and sweep values for every row.

Total BFB sweep across all rows where dad filled in actuals (comparison set): **$21**.

## 12. Out of Scope

The following are explicitly NOT defined here and will be handled separately:
- Tie-breaking rules when multiple teams have the same net score
- Admin overrides on engine output
- UI presentation of the calculation
- Persistence (where the calculated payout is stored)
- Per-hole or per-format payout variants
- HIO fund distribution (separate engine)
- BFB fund accumulation tracking (separate concern)

---

## Appendix A — Decision Log

| Decision | Rationale |
|---|---|
| `CAP = $25` | "Friendly, not greedy" league ethos — no one wins big |
| `FLOOR = $5` | Increased from $4 per dad's feedback to ensure 4th place is a meaningful prize |
| `GAP_PRIMARY = $3` | Visible distinction between places |
| `GAP_FALLBACK = $1` | Prevents ties when proportions, cap, and floor compete for space |
| Proportions 55/30/15 and 50/25/17/8 | Top-heavy split closer to traditional golf league payouts, validated against dad's gut feel |
| Cascade balancing | Allows hard rules (cap, floor, max places) to coexist by treating proportions as a soft target |
| Leftover spreads to players, not BFB | Dad's explicit preference: money stays with players except for truly indivisible scraps |

## Appendix B — Versions

- **v1 (deprecated):** 40/28/20/12 proportions, no cascade. Routed too much money to BFB.
- **v2 (deprecated):** 50/25/17/8 with leftover spread, but dropped places when floor failed.
- **v3 (current):** Adds cascade balancing — pay max places is a hard rule, proportions are soft.
