# GOBS Status

*Auto-maintained by Claude Code at end of each session. For session handoff. Single source of truth for "what's the state right now."*

**Last updated:** 2026-05-10 18:18 PDT
**Session purpose:** LT2 triage on iPhone with Web Inspector. 3 variants run, all clean. LT2 reframed from blocker to watch-item; A1.6 / A1.7 unblocked.

---

## Master branch state

- HEAD commit: `cb01cdc` — `chore(roadmap): LT2 triage clean — A1.6/A1.7 unblocked`
- Status vs production deployment: in sync (Vercel auto-deploys from `master`; this commit is docs-only — no app behavior change)

## Open / unmerged branches

| Branch | Ahead of master | Status | Notes |
| --- | --- | --- | --- |
| `origin/lt2-repro` | 2 commits | watch-item — instrumentation deployed | Held at master HEAD pre-LT1-fix (`e6cfe95`) plus LT2 console-log + `window.__LT2()` snapshot instrumentation (`261eebe`). 2026-05-10 triage on iPhone with Web Inspector: 3 variants (single-player in-app Back; alternate nav; 3 players × 12 rapid-nav steps) all clean — no score reversion, no phantom `setScore`, cumulative pill correct. Score-overwrite and dual-bug-cumulative+persistence ruled out for these scenarios. Branch + instrumentation stay deployed for next live-round observation. |

The `phase-a1-stableford-best-ball-format-picker` branch is **not present** on `origin` or locally — appears to have been deleted on merge. No other open branches.

## Last 5 master commits

- `cb01cdc` — chore(roadmap): LT2 triage clean — A1.6/A1.7 unblocked (2026-05-10)
- `09cbb13` — chore: update STATUS.md (2026-05-10)
- `dadab5b` — chore: establish STATUS.md as session-handoff artifact (2026-05-10)
- `47b9af3` — chore(roadmap): mark Phase A.1 PR 1 merged + verified live (2026-05-10)
- `9228753` — Create STATUS.md (2026-05-10)

## Active blockers / paused work

- **LT2 (scores reverting to par on hole navigation):** **watch-item, not a blocker.** 2026-05-10 triage clean across 3 iPhone variants. Remaining theory: Dad in-the-moment misread during May 8 live round, or a condition not yet hit (specific format / team size / network race). Strategy: leave `origin/lt2-repro` instrumentation deployed and observe in the next live round before any fix work. Does not block A1.6, A1.7, D.1, or any other phase.
- **LT1 (Course Handicap display mismatch):** fix in master (per ROADMAP Decisions Locked terminology note dated 2026-05-09). Verification across full live round still pending — folds into the next live-round test.

## What to do next session (suggested)

1. **A1.6 (F9 / B9 / Total on scorecard team-net pill)** — primary. Drives Nassau payouts for the league. Layout test required at iPhone SE width (375px) — current pill shows a single delta and the three-number layout will be tight.
2. **A1.7 (tap player row → expand hole-by-hole on scorecard)** — secondary. Same data shape as Phase C drill-in (C4/C5/C6); helper code can be shared, but the surface is the live scorecard, not the post-round summary.
3. **Phase D.1 (Blind Draw)** — bigger parallel option if A1.6/A1.7 land quickly or the user wants to push on the larger queued item. May 9 priority order remains Phase 0.5 → A.1 → D.1 → H.2 → Phase C PR 3 → E onward.

---

*If this file is more than 24 hours stale relative to your session work, flag it in the next session as a problem and reconcile before doing other work.*
