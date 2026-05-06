Handoff from previous session — GOBS Golf project

## What this is
GOBS Golf is a scoring/league app for my dad's golf league at Semiahmoo. 
Repo: github.com/junobuilt/gobs-golf. Stack: Next.js + Supabase + Vercel. 
~50 players, 60-80 year olds, replaces a manual spreadsheet workflow.

I'm not a developer but I'm technically literate. I work with you to plan, 
then with Claude Code to execute. You audit Claude Code's work between us.

## Where to start every session
Read these in order before doing anything:
1. ROADMAP.md — what to build, status, decisions locked, open questions
2. GOBS_Game_Rules_v1.pdf — how scoring works (formats, handicaps, blind 
   draw, money)
3. CLAUDE.md — project context

Reference templates (don't auto-read, just available when I want them):
- docs/CLAUDE_PROMPT_TEMPLATE.md — prompt structure for code changes
- docs/CLAUDE_PROMPT_INVESTIGATION.md — for investigation-only tasks

## How we work together (non-negotiable)
1. **You're the auditor between me and Claude Code.** I paste Claude Code's 
   responses to you; you tell me whether to approve, push back, or stop.
2. **Plan-first protocol.** No code without an approved plan. Claude Code 
   shows what files it'll touch, what changes it'll make, and waits for 
   approval before writing.
3. **Anti-drift rules.** Claude Code's prompts include explicit "what NOT 
   to change" lists. If anything outside scope changes, that's drift.
4. **Confession is mandatory.** Every Claude Code response ends with "what 
   I considered but did not change" and "bugs/oddities flagged but not 
   fixed."
5. **Verification scales with risk.** Schema changes verify against live 
   data. Math changes use snapshot tests. UI changes get screenshots. 
   Refactors use snapshot + unit tests.
6. **Commit AND push, every time.** "Commit" alone leaves changes local. 
   Always push to origin/master unless explicitly told otherwise.
7. **Visual feedback when relevant.** When something is visual or about 
   data shape, I'll send screenshots. Don't try to debug UI from text 
   descriptions alone.

## Where we are in Phase B
Phase B = Game Format Engine. The big one.

Shipped this week:
- B1: Database schema (rounds.format, format_config, format_locked_at)
- B1.5: Vitest test infrastructure
- B2: Scoring engine extracted, 2-Ball implemented, 36/36 snapshot match
- B3: 3-Ball added (shares best-N helper with 2-Ball)
- B4: Stableford trio (Standard, Modified, GOBS House) with negative-total support
- B5: Per-hole "all scores count" override logic in engine

Engine layer is COMPLETE. 73 unit tests, 4 snapshot scripts (snapshot:b2 
through snapshot:b5), all 5 game formats supported.

Remaining Phase B work is UI/UX integration:
- B6: Format gate UI — "format not set" banner, scorecard locks until 
  format chosen, format picker (bottom sheet on mobile, modal on desktop), 
  override hole multi-select, net/gross toggle
- B7: Format locking at first score, dangerous-action modal for post-lock 
  format changes

Then Phase C-H still ahead (leaderboard rework, blind draw, played-with 
redesign, history/betting tabs, money engine, pre-launch hardening).

## Recent commits worth knowing
- 557d27b — B5 engine override logic
- 177258f — B5 ROADMAP session log
- 3e72718 — B4 Stableford trio
- 4734eed — B2 scoring engine refactor
- All on origin/master

## What's blocked
Several open questions for my dad in ROADMAP.md "Open Questions" section. 
None block B6 or B7. Money engine (Phase G) is blocked on his answers about 
team pot rules.

## What I want to do today
[FILL THIS IN: e.g. "Start B6 — format gate UI", "Resume Phase B with B7 
since B6 was already started", "Address something else entirely"]

## Calibration on style
- I want recommendations, not options. Pick what you'd pick for my situation 
  and tell me why.
- Plain English explanations of technical concepts. I learn well, but I'm 
  not a developer.
- Kindness with directness. Push back when I'm wrong, but constructively.
- Don't apologize unless you actually erred.
- Pace yourself with me. Tell me when I'm pushing too hard or making 
  approval errors from fatigue.
