---
name: frontend-design
description: Design discipline for GOBS Golf UI work. Use whenever building or reshaping any user-facing surface (scorecard, leaderboard, betting tab, history, admin). Codifies the design-token system, the 60–80 accessibility floor, and the process that keeps v2 polish consistent across screens instead of improvised per-file.
---

# GOBS Golf — Frontend Design

Approach every screen as the design lead for a product with a real, specific user: a senior men's golf league, ~50 players aged 60–80, used outdoors on phones in sunlight, mid-round, sometimes one-handed. The app is functional today. The job of any design work is to make it feel intentional and trustworthy — less like a default template, without ever trading away legibility or tap reliability for that demographic.

The brief is always pinned: **subject** = a weekly senior golf league; **audience** = players 60–80 + one admin (Dad); **the page's single job** = let someone read or enter golf information fast, outdoors, without error. Derive distinctive choices from golf's own world (scorecards, traditional notation, course aesthetics, the navy/green palette of a country club) — not from generic SaaS.

## Non-negotiable floor (this demographic)

These are constraints, not preferences. Never spend a design risk here.

- **Contrast:** body text and any score/number against its background meets WCAG AA (4.5:1 normal, 3:1 large). Outdoor phone use means err brighter/darker, not subtler.
- **Tap targets:** interactive elements ≥ 44×44px with real spacing between them. The +/− score buttons and nav are the most-tapped things in the app — they get the most room.
- **Type size:** no body or data text below 14px; primary scores and the things people read at a glance stay large. Prefer scaling up over packing in.
- **Motion:** subtle and purposeful only. Respect `prefers-reduced-motion`. No motion on score entry — confirmation must be instant and obvious, never animated-away.
- **Fat-finger safety:** destructive or state-changing actions (finalize, delete, drag-to-move) are deliberate, confirmed, and hard to trigger by accident. Drag-and-drop is **admin-surface only** (team building) — never on player-facing flows.
- **Keyboard focus** visible; the app stays usable down to a small phone viewport.

## Design tokens are the system

v2 polish lands as **tokens**, not one-off values. No raw hex, spacing, or font declarations scattered per component — define them once and reference them everywhere, so a single change propagates and screens stay consistent. This is load-bearing: it's what stops the redesign from drifting into 12 slightly-different blues.

**Starting palette (already in use — extend, don't replace ad hoc):**

- `--navy` `#042C53` — primary brand / headers / rank badges
- `--accent` `#c2410c` — orange; allowance, GHIN-adjusted, blind-draw, override markers
- `--hole-now` `#dbeafe` — current-hole highlight
- `--muted` `#94a3b8` — secondary / unplayed / captions
- rank gold (1st place) — formalize into a token when v2 starts

A v2 direction may broaden this (a considered neutral scale, depth for cards, a green that reads "course"), but every new value gets named and justified against the brief.

## Type carries the personality

Pair a display face and a body face deliberately — not the system default that reads as "AI built this." Set one clear type scale with intentional weights. The score numbers are the app's most important type moment; treat them as a designed element (you already use traditional notation marks — circles under par, squares over — lean into that golf vernacular rather than generic green/red text).

## Process: plan tokens → critique against defaults → build → critique again

1. **Plan first.** Before code, write a compact token plan: 4–6 named colors, 2+ type roles, a layout concept (ASCII wireframe is fine), and the one signature element the screen is remembered by.
2. **Critique against the generic default.** AI design clusters on a few looks (cream + serif + terracotta; near-black + acid accent; broadsheet hairlines). If the plan drifts there *by default rather than by choice for this golf brief*, revise it and say what changed.
3. **Build to the plan**, deriving every value from the tokens.
4. **Self-critique.** Spend boldness in one place; keep everything around the signature quiet. Remove one thing before shipping. Verify the floor above on a real phone viewport.

Do the iteration in planning; only surface directions to Jonathan when confident they'll land. Comps are reviewed in chat before any screen is coded.

## Writing is design material

Copy is for navigation, not decoration. Name things by what the user controls ("Submit final scores," not "Commit round"). An action keeps its name through the whole flow — the button that says "Finalize" produces a toast that says "Finalized." Errors explain what happened and how to fix it, in the interface's voice, without apologizing or being vague. Empty states invite an action. Sentence case, plain verbs, no filler — tuned for an older, non-technical reader.

## CSS hygiene

Watch selector specificity — type-based (`.section`) and element-based (`.cta`) selectors cancel each other out, most often on section padding/margins. Keep the cascade predictable.
