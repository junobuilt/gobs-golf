# GOBS Status

*Auto-maintained by Claude Code at end of each session. For session handoff. Single source of truth for "what's the state right now."*

**Last updated:** 2026-05-10 18:35 PDT
**Session purpose:** A1.6 Step 1 — static team-pill mockup on `phase-a1-team-pill-segments` branch. Preview deployed for Jonathan to eyeball at iPhone SE width. Live scorecard pill on master is untouched; do not merge.

---

## Master branch state

- HEAD commit: `89f95ab` — `chore: update STATUS.md`
- Status vs production deployment: in sync (Vercel auto-deploys from `master`; master itself has not changed since the LT2-triage trailing sync)

## Open / unmerged branches

| Branch | Ahead of master | Status | Notes |
| --- | --- | --- | --- |
| `origin/phase-a1-team-pill-segments` | 1 commit (`3afe566`) | awaiting visual review — do not merge | A1.6 Step 1: static team-pill mockup. New component `src/components/scorecard/TeamPillSegments.tsx` + temp route `src/app/mockup/team-pill/page.tsx` exercising all 6 required combos plus 3 edge cases and a height-parity strip. Live scorecard pill on master is untouched. Vercel preview: `https://gobs-golf-git-phase-a1-team-pill-segments-junobuilts-projects.vercel.app/mockup/team-pill` (SSO-gated; Jonathan signs in via Vercel). Step 2 (engine wiring) starts only after Jonathan approves the look. |
| `origin/lt2-repro` | 2 commits | watch-item — instrumentation deployed | Held at master HEAD pre-LT1-fix (`e6cfe95`) plus LT2 console-log + `window.__LT2()` snapshot instrumentation (`261eebe`). 2026-05-10 triage on iPhone with Web Inspector: 3 variants (single-player in-app Back; alternate nav; 3 players × 12 rapid-nav steps) all clean — no score reversion, no phantom `setScore`, cumulative pill correct. Score-overwrite and dual-bug-cumulative+persistence ruled out for these scenarios. Branch + instrumentation stay deployed for next live-round observation. |

No other open branches.

## Last 5 master commits

- `89f95ab` — chore: update STATUS.md (2026-05-10)
- `cb01cdc` — chore(roadmap): LT2 triage clean — A1.6/A1.7 unblocked (2026-05-10)
- `09cbb13` — chore: update STATUS.md (2026-05-10)
- `dadab5b` — chore: establish STATUS.md as session-handoff artifact (2026-05-10)
- `47b9af3` — chore(roadmap): mark Phase A.1 PR 1 merged + verified live (2026-05-10)

(Master has not advanced this session — A1.6 Step 1 work landed on `phase-a1-team-pill-segments`, not master.)

## Active blockers / paused work

- **LT2 (scores reverting to par on hole navigation):** **watch-item, not a blocker.** 2026-05-10 triage clean across 3 iPhone variants. Remaining theory: Dad in-the-moment misread during May 8 live round, or a condition not yet hit (specific format / team size / network race). Strategy: leave `origin/lt2-repro` instrumentation deployed and observe in the next live round before any fix work. Does not block A1.6, A1.7, D.1, or any other phase.
- **LT1 (Course Handicap display mismatch):** fix in master (per ROADMAP Decisions Locked terminology note dated 2026-05-09). Verification across full live round still pending — folds into the next live-round test.

## What to do next session (suggested)

1. **A1.6 Step 2 — engine wiring on `phase-a1-team-pill-segments`.** Triggered by Jonathan's approval of the Step 1 mockup. Compute F9 = sum of team-net minus team-par over scored holes 1–9; B9 = same over 10–18; Total = F9 + B9. Reuse `computeRoundResult` from `src/lib/scoring/engine.ts` — no new engine math. For Stableford, `teamPar = 0` per engine contract, so the same subtraction collapses to absolute points naturally. Render each segment through `formatTeamTotal`. `null` when the segment has zero scored holes for the team. Do **not** touch the live scorecard pill on master yet — wire the engine inside the mockup route first, then swap the live pill in a separate commit once values match by-hand math.
2. **A1.6 Step 3 — verification.** New `tests/lib/scoring/segment-totals.test.ts` covering F9/B9/Total reconcile for best-N delta + Stableford; empty-segment returns null; mid-segment partial scoring returns correct partial sum. `tsc --noEmit` + snapshots b2–b6 must stay clean (no engine math is being changed; snapshot drift = bug).
3. **A1.7 (tap player row → expand hole-by-hole on scorecard)** — queued behind A1.6 land. Separate PR. Same data shape as Phase C drill-in (C4/C5/C6); helper code can be shared, but the surface is the live scorecard, not the post-round summary.
4. **Phase D.1 (Blind Draw)** — bigger parallel option if Jonathan wants to push on the larger queued item while A1.6 review cycles. May 9 priority order remains Phase 0.5 → A.1 → D.1 → H.2 → Phase C PR 3 → E onward.

---

*If this file is more than 24 hours stale relative to your session work, flag it in the next session as a problem and reconcile before doing other work.*
