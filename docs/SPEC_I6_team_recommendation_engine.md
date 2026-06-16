# SPEC — Team Recommendation Engine (I6)

*Verbatim spec as provided by Jonathan Yang, 2026-06-16. Implemented same session.*

---

## 0. Decisions locked

| Decision | Value |
| --- | --- |
| Conflict rule | **Balance = hard guardrail; novelty optimized within it.** Never trade balance for novelty. |
| Output shape | Full-team assignment for the day; admin tweaks via existing Edit Teams. |
| v1 scope | **No player-pinning** (run + tweak only). Pinning = fast-follow. |
| Balance tolerance | Admin-set in the tool; default **2.5** CH points max spread between team averages. |
| Balance metric | **Course Handicap** (CH snapshot), not Handicap Index. CH is what determines net competitiveness; the league may mix tees. |
| Team partition input | Admin picks **either "teams of N" or "N teams"** (toggle). Engine evens the remainder in both modes (14 @ size 4 → 4/4/3/3; 14 @ count 4 → 4/4/3/3). |
| Multi-flight scope | v1 produces **one round-wide partition**. Flight targeting deferred (Flights.6). |
| Novelty scope | **This-season by default**, all-time toggle. Mirrors the Played-With default (E5/E6). |
| Migration | **None.** Pure function over existing reads; tolerance is transient UI state, not persisted. |

---

## 1. Mental model

A round-setup tool that proposes a full set of balanced, novel teams the admin can apply with one tap and then tweak. **Balance is a feasibility constraint; novelty is the objective.** The engine never produces an unbalanced arrangement to chase novelty — it finds the *most-novel arrangement that stays inside the balance band*, and if it can't meet the band it says so and shows the closest it found. No black-box score; every move is explainable as "these players have played their teammates less."

**Substrate (all shipped):** played-with compute (`src/lib/playedWith/compute.ts`), CH snapshots (`round_players.course_handicap` → `computeCourseHandicap`), team-assignment write path (A.2). CC: bind to real signatures in plan-mode.

---

## 2. Pure function contract

`src/lib/teamRecommend/recommend.ts` (pure, no IO):

```ts
recommendTeams({
  players: { id: number; courseHandicap: number }[],
  pairCounts: (a: number, b: number) => number,   // prior rounds-together, from played-with compute
  partition:                                        // admin's choice of how to split
    | { mode: "size"; value: number }               // "teams of N"
    | { mode: "count"; value: number },             // "N teams"
  toleranceCH: number,                              // default 2.5
  seed?: number,                                     // for re-roll; same seed → same output
}): {
  teams: { playerIds: number[]; avgCH: number }[],
  spread: number,            // max(avgCH) − min(avgCH)
  noveltyCost: number,       // total prior pairings across all within-team pairs (lower = more novel)
  metBand: boolean,          // spread ≤ toleranceCH
  notes: string[],           // human-readable explanation lines
}
```

**Novelty cost = sum, over every within-team pair, of `pairCounts(a,b)`.** Never-paired pairs contribute 0; a pair that's played 4× contributes 4. Minimizing this maximizes novelty.

---

## 3. Algorithm — greedy seed + local search

**Step 1 — Even team sizes.** Derive team count `k`: if `partition.mode === "count"`, `k = value`; if `"size"`, `k = round(headcount / value)` (≥1). Then distribute players so sizes differ by at most 1 (e.g. 14 across 4 teams → 4/4/3/3).

**Step 2 — Greedy seed (snake draft by CH).** Sort players by CH descending; snake-draft into the `k` teams (T1→Tk, then Tk→T1, repeat). Snake draft is inherently balance-friendly.

**Step 3 — Local search (two-phase, balance-constrained swaps).**

- **Feasible branch (seed spread ≤ tol):** cap 500 iterations. Each pass: find the best swap (highest noveltyCost improvement) that keeps `spread ≤ toleranceCH`. Stop on no improvement.
- **Infeasible branch (seed spread > tol):** separate cap-500 loop. Each pass: find the swap that lex-minimizes `(spread, noveltyCost)`. Stop on no improvement. If the spread-minimizing search drops below `tol`, run the feasible branch on top.

**Step 4 — Report.** Return teams, spread, noveltyCost, metBand, notes.

---

## 4. Edge cases

- **Band infeasible:** return `metBand: false` with the best-balance arrangement found and a note: *"Couldn't meet the N-pt band; closest spread X.X."*
- **Headcount < targetTeamSize:** one team of everyone; `metBand` trivially true.
- **All pairs equally played:** noveltyCost can't reach 0; engine still balances and reports the floor.
- **Missing CH snapshot** (not yet computed for a present player): the modal derives CH via `computeCourseHandicap(handicap_index, slope, rating, par)` using tee fallback chain `round_players.tee_id ?? players.preferred_tee_id ?? DEFAULT_TEE_ID`. Only players with null `handicap_index` are excluded and listed in notes.
- **Odd headcount / blind-draw rounds:** engine just partitions present players; short-team/blind-draw handling is unchanged and happens later at finalize.

---

## 5. Worked example (sanity check)

8 players, teams of 2 → 4 teams. Course Handicaps: A 10, B 10, C 12, D 12, E 14, F 14, G 16, H 16.
Prior pairings this season: **A–H played 3×, B–G played 2×**, everyone else 0.

**Seed (snake draft by CH desc):** H,G,F,E then reverse D,C,B,A:
- T1 {H 16, A 10} avg 13 · T2 {G 16, B 10} avg 13 · T3 {F 14, C 12} avg 13 · T4 {E 14, D 12} avg 13
- Spread **0** (well inside band). Novelty cost = A–H (3) + B–G (2) = **5**.

**Local search.** Swap A (T1) and B (T2) — both CH 10, so team averages don't move (spread stays 0). New teams: T1 {H,B}, T2 {G,A}. If H–B and G–A are unplayed, novelty cost drops **5 → 0**. Balance-neutral *and* improving → accept.

**Result:** spread 0, novelty cost 0, metBand true. Note: *"Swapped A↔B to cut repeat pairings by 5 (balance unchanged at 0.00 pts)."*

---

## 6. UI surface

**Entry:** "Recommend Teams" button on the admin **Round Setup** tab, sibling to "Edit Teams."

**Flow:**
1. Tap → bottom sheet. Controls: **Split by [Team size | Team count]** segmented toggle with a stepper, **Balance tolerance** stepper (default 2.5), **Novelty scope** toggle (This season / All-time, default This season).
2. Tap **Generate** → preview the proposed teams: each team with roster + avg CH, plus a header readout **"Spread X.X pts · Repeat pairings: N"** and any `notes`. If `metBand` is false, an amber line: *"Couldn't meet the N-pt band — closest spread X.X."*
3. **Re-roll** button → new randomized seed → fresh result.
4. **Apply** → writes assignments via the A.2 write path, closes the modal, lands the admin in **Edit Teams** for manual tweaks.

**Overwrite guard:** if teams are already non-empty when Apply is tapped, route through `DangerModal` ("Replace current teams?") before writing. If empty, apply directly.

**Preview-before-write is required** — generating must never mutate until Apply.

---

## 7. Defaults

| Open item | Default |
| --- | --- |
| Re-roll | New randomized seed → fresh local search; report spread + cost per run. |
| Novelty scope | This season (toggle to all-time). |
| Apply path | A.2 write path → open Edit Teams. Overwrite guarded by DangerModal. |
| Tolerance persistence | Transient (session only). Default constant 2.5. No migration. |

---

## 8. Implementation notes (post-build, 2026-06-16)

- **ID type:** `number` throughout (matching `players.id: integer`). Spec used `string` abstractly.
- **`pairCounts` source:** `computePairMatrix(rpRows)` added to `src/lib/playedWith/compute.ts`. Reuses `RoundPlayerRow` shape and round+team partnership semantics from `computeBuckets`.
- **CH derivation:** modal computes CH on-the-fly for null-snapshot players via `computeCourseHandicap` + tee fallback chain `round_players.tee_id ?? players.preferred_tee_id ?? DEFAULT_TEE_ID`. Engine stays pure.
- **Season ID:** captured from `ensureSeasonAndRoundShell` result and the round load; stored as `activeSeasonId` state in RoundSetup.
- **Size-mode rounding:** `round(headcount/size)` — 10 @ size 4 yields 3 teams `[4,3,3]`. Spec §0 locks even-out behavior. Preview surfaces actual sizes; Thomas/Dad can confirm or request one-line flip after first use.
- **Infeasible branch:** runs a real spread-minimizing loop (lex-min on `(spread, novelty)`) rather than returning the seed untouched. Hands off to the feasible-branch loop if spread drops into band.
