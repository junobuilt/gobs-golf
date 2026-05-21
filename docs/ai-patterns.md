# AI-Assisted Dev Patterns — GOBS Reference

A living reference for the AI-assisted-dev patterns I'm using or want to learn on this project. Sits alongside `ROADMAP.md`, `STATUS.md`, and `CLAUDE.md`.

**When to read this:** when starting a new feature, when I sense I'm trial-and-erroring through something the community has figured out, or when I want to see what I've already internalized.

**How to maintain:** when I learn a pattern that worked, add it here. When I discover something didn't, note that too. Treat as a lessons-learned log.

---

## Part 1: Patterns to learn (priority order)

### 1\. Skills — build a `gobs-feature-plan` skill

**What:** A skill is a `.claude/skills/<name>/SKILL.md` file that defines a reusable prompt/playbook. Once defined, invoke via `/skill-name` from any Claude Code session. Skills can also auto-invoke when Claude detects relevant context. This is the modern replacement for older `.claude/commands/` files.

Bundled skills that ship with Claude Code: `/batch`, `/simplify`, `/loop`, `/debug`. User skills work identically.

**Why it's high-leverage for GOBS:** I've run the same planning pattern at least four times now (read ROADMAP → check dependencies → identify open questions → draft spec → package handoff). A skill templates it. Every future feature uses `/gobs-feature-plan [phase]` instead of rebuilding from scratch.

**Build target — `.claude/skills/gobs-feature-plan/SKILL.md`:**

\---

name: gobs-feature-plan

description: Run the standard GOBS feature planning playbook for a new phase or feature.

allowed-tools: Read, Grep, Glob

\---

\# GOBS Feature Planning Playbook

When invoked, run this playbook to plan a feature before any code:

1\. Read ROADMAP.md and find the phase or item the user named. Quote relevant rows.

2\. Check listed dependencies — are they shipped (✅), in progress (🔨), or blocked (📋/❓)?

3\. Identify open design questions:

   \- Cross-reference Open Questions for Dad table

   \- Note any decisions in Open Design / Technical Decisions

4\. Draft a spec with these sections:

   \- Mental model (1 paragraph)

   \- Data model changes (existing tables touched, new tables/columns)

   \- Surfaces (each UI surface with concrete spec)

   \- Engine/logic behavior

   \- Edge cases

   \- Out of scope

5\. List handoff prerequisites — what else must land first?

6\. Generate a handoff prompt the user can paste into a Claude Code implementation session.

Do NOT write any code. Do NOT modify any files. Output the plan to chat for review.

**Then:** `/gobs-feature-plan Phase E Played-With redesign` runs the playbook.

Other skills worth building as patterns emerge:

- `gobs-status-update` — codify the STATUS.md update conventions  
- `gobs-bug-triage` — Sentry error → classify → assign priority → draft fix prompt

### 2\. Plan Mode (`/plan`)

**What:** A built-in Claude Code mode where Claude proposes its approach step-by-step and waits for approval before executing. Invoke standalone or with a description: `/plan fix the auth bug`.

**Why it matters:** Structural enforcement of the planner-first instinct. Forces Claude to articulate "here's what I'll touch and in what order" before any file changes.

**When to use:**

- Default for any change touching 3+ files  
- Default for any new feature  
- Skip for trivial fixes (single typo, one-line change)  
- Pairs with the pre-implementation walkthrough pattern

**Real example from D.1 night:** Claude Code missed the plus-button gate because `replace_all` had different surrounding context for the two buttons. In plan mode, Claude would have had to articulate "I'm gating these two affordances" — likely catching the discrepancy before code.

### 3\. Subagents and parallel work

**What:** Subagents are isolated Claude sessions that handle delegated side tasks while the main session keeps focus. Main session stays clean; subagent does the errand and reports back.

Related commands:

- `/agents` — manage subagent configs  
- `/tasks` — list running background tasks  
- `/background` — detach the current session entirely to run as a background agent  
- `/batch <instruction>` (bundled skill) — decompose cross-codebase changes into 5–30 independent units, spawn one subagent per unit in isolated git worktrees

**Rule of thumb:** Read-only investigation that takes \>5 minutes \= subagent task. Implementation \= main session.

**Examples of good subagent tasks:**

- "Find every place a pattern is used in src/"  
- "Verify which files import X"  
- "Check if any tests cover Y"  
- "Read these three files and summarize what each does"

**Real example from D.1 night:** Claude Code spent real time hunting down leftover "Finalize" buttons in the codebase. Could have been a subagent: "subagent: grep for any UI element calling itself 'Finalize', 'Finish Round', or 'End round' and report locations" while main session continued specing the submit-button work.

**How to invoke:** Mid-session, ask Claude: *"Spawn a subagent to audit X. Report back. Don't modify anything."*

---

## Part 2: Patterns I'm already using

### Planning in claude.ai, execution in Claude Code

Two different tools for two different jobs. Plans/decisions/walkthroughs in chat. Code in Claude Code. Hand off via written specs, never just verbal context.

### Roadmap-then-chunk decomposition

`ROADMAP.md` lives in repo, browsable via GitHub Pages. Major phases broken into numbered items (D1.1, D1.2, etc.) with status emojis (📋 planned, 🔨 in progress, ✅ shipped, 💡 dormant). Decisions Locked section captures rationale for non-obvious calls.

### STATUS.md as machine-readable handoff

Each Claude Code session reads STATUS.md first to learn where the project stands without re-briefing. Updates STATUS.md at session end so the next session has continuity. Includes last commits, test count, and next-session priorities.

### CLAUDE.md for repo-specific context

Schema notes, commit rules, file locations, tech debt callouts. Read on every Claude Code session start. Keeps Claude oriented without re-explaining basics. Caveat: keep it current — stale schema docs caused real confusion on D.1.

### Parallel Claude Code sessions on independent files

When two pieces of work don't touch the same files, run them in two terminals. Session A works on the scorecard refactor; session B works on the summary view. Saves real wall-clock time. Caveat: commit and pull frequently to avoid divergence; commit direct to master so merges don't pile up.

### Verify-before-spec

Before sending a multi-file spec to Claude Code, send a smaller "go read these files and report back" prompt first. Confirms file paths, component names, and prop shapes are still what we think they are. Catches drift caused by recent merges. Tens of minutes saved per spec.

### Pre-implementation walkthrough (newly adopted)

Before sending a spec to Claude Code, walk through the spec as a user tapping through the feature. \~10 min. Catches bugs at design time. *Should have done this for D.1 — would have caught the auto-fire-on-first-tap issue before deploy.*

### Token discipline

Use claude.ai chat for design tradeoffs and decisions only Claude can help with. Decide small things myself rather than asking. Update tallies incrementally instead of restating. Confirm in one line, not a paragraph. (Working on this.)

---

## Part 3: Where these patterns are wired in

| Pattern | Lives in |
| :---- | :---- |
| Coaching mode (proactive teaching) | claude.ai project instructions |
| Tactical patterns (this doc) | `docs/ai-patterns.md` in repo |
| Repo conventions (schema, commits, file locations) | `CLAUDE.md` in repo root |
| Current state for next session | `STATUS.md` in repo root |
| Project phases and locked decisions | `ROADMAP.md` in repo root |
| Reusable Claude Code workflows | Future `.claude/skills/<name>/SKILL.md` files |

The claude.ai project instructions handle proactive teaching ("when Jonathan's about to trial-and-error, flag it"). This doc handles tactical reference. CLAUDE.md handles Claude Code session context. Each layer has a job.

---

## Part 4: Patterns I'm watching for but haven't tried

- `/simplify` — bundled skill that runs a 3-agent review pipeline for code quality before PRs. Could have caught the leftover Finalize button.  
- `/rewind` — rolls code and conversation back to a checkpoint. Safer than manual git reset when Claude Code goes down a wrong path.  
- `/diff` — interactive diff viewer for uncommitted changes. Worth using before every commit instead of `git diff` in another terminal.  
- Hooks (`.claude/hooks/`) — automated actions on tool events. Could enforce things like "always run tsc before commit."  
- `/insights` — generates a report on session patterns and friction points. Could surface where I'm spending time inefficiently.

---

## Part 5: Lessons learned (anti-patterns to avoid)

- **Don't treat Claude Code as the test step.** It catches type errors and test failures, not UX bugs. Live verification is on me.  
- **Don't accept "tsc clean, tests pass" as proof of correctness.** D.1 shipped with auto-fire-on-first-tap despite both passing.  
- **Don't skip the verify-before-spec step.** When dependencies are recent merges, file/component shapes drift.  
- **Don't pile up uncommitted work across parallel sessions.** Merge conflicts cost more time than the parallelism saves.  
- **Don't ask claude.ai for things you can decide yourself.** Token cost is real on the Max plan — the chat budget is shared with Claude Code.

---

*Last updated: May 18, 2026 — initial capture after D.1 (Blind Draw) ship.*  
