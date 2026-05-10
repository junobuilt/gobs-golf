# GOBS Status

*Auto-maintained by Claude Code at end of each session. For session handoff. Single source of truth for "what's the state right now."*

**Last updated:** 2026-05-10 16:25 PDT
**Session purpose:** Mark Phase A.1 PR 1 merged + verified live in ROADMAP. Establish STATUS.md as the session-handoff artifact (template + CLAUDE.md rule + Pages publish path).

---

## Master branch state

- HEAD commit: `dadab5b` — `chore: establish STATUS.md as session-handoff artifact`
- Status vs production deployment: in sync (Vercel auto-deploys from `master`; A.1 PR 1 verified live earlier today; this trailing commit is docs-only — no app behavior change)

## Open / unmerged branches

| Branch | Ahead of master | Status | Notes |
| --- | --- | --- | --- |
| `origin/lt2-repro` | 2 commits | paused — instrumentation branch | Held at master HEAD pre-LT1-fix (`e6cfe95`) plus LT2 console-log + `window.__LT2()` snapshot instrumentation (`261eebe`). Waiting on user iPhone repro before fix work resumes. |

The `phase-a1-stableford-best-ball-format-picker` branch is **not present** on `origin` or locally — appears to have been deleted on merge. No other open branches.

## Last 5 master commits

- `dadab5b` — chore: establish STATUS.md as session-handoff artifact (2026-05-10)
- `47b9af3` — chore(roadmap): mark Phase A.1 PR 1 merged + verified live (2026-05-10)
- `9228753` — Create STATUS.md (2026-05-10)
- `2108a5e` — chore(roadmap): mark I1 + I3 shipped (2026-05-10)
- `6179f66` — feat(player): add Round History (I1) and Season Stats (I3) accordions (2026-05-10)

## Active blockers / paused work

- **LT2 (scores reverting to par on hole navigation):** paused on user iPhone reproduction. Repro branch `origin/lt2-repro` at SHA `261eebe` carries console-log + `window.__LT2()` snapshot instrumentation on top of `e6cfe95` (master HEAD held pre-LT1-fix). Resumes when user runs the repro recipe on the iPhone and reports back.
- **Phase A.1 A1.6 / A1.7 (F9/B9/Total pill; tap player row → expand):** deferred — both sit on the live score-entry / hole-navigation surface that's frozen until LT2 is reproduced and fixed. Ships in a follow-up PR once LT2 is closed.
- **LT1 (Course Handicap display mismatch):** fix in master (per ROADMAP Decisions Locked terminology note dated 2026-05-09 referencing the LT1 fix). Verification across full live round still pending — folds into the next live-round test.

## What to do next session (suggested)

1. Confirm whether user has run the LT2 repro on iPhone yet (check `origin/lt2-repro` for any new commits / notes; ask user for `window.__LT2()` output). If yes → diagnose + fix. If no → unblock the repro recipe.
2. If LT2 stays blocked, pick up **Phase D.1 (Blind Draw)** per the May 9 priority order (Phase 0.5 → A.1 → D.1 → H.2 → Phase C PR 3 → E onward). A.1 PR 1 is merged; D.1 is the next greenfield item that doesn't touch the LT2-paused score-entry surface.
3. Re-verify A.1 in the next live round: GOBS Stableford editable point values, Best Ball net-only lock, format picker on admin Round Setup tab. Capture any issues into ROADMAP Phase A.1 follow-up rows before they get lost.

---

*If this file is more than 24 hours stale relative to your session work, flag it in the next session as a problem and reconcile before doing other work.*
