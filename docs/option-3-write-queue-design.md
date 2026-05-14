# Option 3 — Write Queue Design

**Status:** Decisions locked. Implementation broken into shippable phases.
**Author:** Claude (Track B investigation).
**Owner:** Jonathan.

---

## Why this exists

Bug 1 (scores reverting to par) is reproduced on demand by Phase 3's
Sequence D′ test. The mechanism: `setScore` updates local state
optimistically, then awaits a Supabase SELECT-then-INSERT/UPDATE pair.
If the write fails silently (uncaught error in `{data, error}`) or the
tab is evicted before the writes complete, the optimistic value lives
only in React state. On the next mount, `load()` rehydrates from the
DB and overwrites local state — losing the write.

The first-tap fallback in the `+`/`−` buttons writes par as the
starting value, which is why the user-visible symptom is "scores
changed to par" rather than "scores disappeared."

This document designs a durable write queue that makes optimistic
writes survive tab eviction, transient network failures, and slow
networks **without changing the UX of the scorecard during play.**

---

## Scope

**In scope:** persisting score writes from the scorecard to Supabase
durably and idempotently, with retry-on-failure, an end-of-round
reconciliation flow, and safe behavior across tab eviction and offline
networks.

**Out of scope** (explicit, see bottom of doc): real-time multi-device
sync, optimistic concurrency / version checks, conflict resolution UI,
offline support for non-scoring features, IndexedDB migration, audit
trail.

---

## Decisions at a glance — all locked

| # | Decision | Locked value |
|---|---|---|
| D1 | Storage layer | `localStorage` |
| D2 | Storage key namespace | `gobs:write-queue:v1` (single global queue) ✅ |
| D3 | Queue identity per item | `(round_player_id, hole_number)` |
| D4 | Pending-item collapsing | replace pending item with same key |
| D5 | In-flight collapsing | don't collapse; new pending item appended |
| D6 | DB conflict resolution | unique constraint + `upsert(... { onConflict })` |
| D7 | Retry policy | exp backoff 1→120s then 120s forever; **no give-up during round**; 6h stuck-too-long timer ✅ |
| D8 | Failure classification | 4xx = terminal, 5xx + network = retry |
| D9 | UI indicator | **invisible during play**; reconciliation flow on End Round; prompt on app open if stale terminal items exist ✅ |
| D10 | Drain triggers | enqueue (immediate), online, visibilitychange, pageshow, mount, 30s timer |
| D11 | Multi-tab coordination | rely on DB idempotency (no leader election) ✅ |
| D12 | Pre-drain on `pagehide` | best-effort, not load-bearing |
| D13 | Storage quota handling | evict oldest terminal_failure first, then oldest pending, log to Sentry |
| D14 | Sentry instrumentation | terminal failures + invariants only |

---

## D1. Storage layer

**Locked:** `localStorage`.

**Alternative considered:** IndexedDB.

**Rationale:** Each queue item is ~200 bytes. A worst-case round (4
players × 18 holes × 5 retries) is ~360 items ≈ 72KB. The 5MB
`localStorage` budget per origin is two orders of magnitude headroom.
The synchronous API is simpler than IndexedDB's transaction model, and
synchronous writes mean we can drop an item to disk in the same tick
we update React state — no "write enqueued but lost before disk"
window.

IndexedDB would matter if we needed (a) cross-tab change notifications
at the storage layer, (b) >5MB of pending writes, or (c) structured
indexes. None apply. We can migrate later if needed; the queue API
should not leak its storage choice.

---

## D2. Storage key namespace ✅ Locked

**Locked:** `gobs:write-queue:v1` — single global queue, all rounds
mixed.

**Alternative considered:** Per-round queues: `gobs:write-queue:v1:{round_id}`.

**Rationale:** A single global queue makes drain simple — on mount of
*any* page, drain everything. Items carry `round_player_id` which
transitively pins them to a round; no per-round routing logic needed.

The cost of "global" is that terminal-failed items from one round
linger in the namespace until manually purged by the user via the
on-open prompt (D9). That's an acceptable tradeoff: the alternative
adds routing logic and partition lifecycle management for a marginal
storage-hygiene benefit.

---

## D3. Queue item shape

```ts
type QueueItem = {
  id: string;              // uuid (crypto.randomUUID)
  kind: "score_upsert";    // discriminator; future-proofs for other writes
  payload: {
    round_id: number;
    round_player_id: number;
    hole_number: number;   // 1..18
    strokes: number;       // 1..20
  };
  enqueued_at: number;     // Date.now(), local clock — not used for ordering vs DB
  attempts: number;        // 0 on enqueue, ++ on each retry
  last_attempt_at: number | null;
  next_attempt_at: number; // Date.now() initially; updated by backoff
  state: "pending" | "in_flight" | "terminal_failure";
  // For human-readable end-of-round dialog (D9), so we don't need to
  // re-join against the players/holes tables when the queue is offline.
  display: {
    player_name: string;
    hole_label: string;    // e.g. "Hole 7"
  };
};
```

**Identity key for collapsing / status display:**
`(payload.round_player_id, payload.hole_number)`. `round_id` is
redundant given `round_player_id` is round-scoped, but kept for
ergonomic filtering. `display` is denormalized so the end-of-round
dialog can render names even if the DB is unreachable.

Storage representation: array of items serialized to JSON. On every
mutation we rewrite the whole array (atomic-per-key in localStorage).

---

## D4. Write collapsing (pending items)

When `enqueue(payload)` is called and a `pending` item already exists
with the same `(round_player_id, hole_number)`:

- **Replace** that item's payload with the new one.
- Reset `attempts = 0` and `next_attempt_at = Date.now()` (the user
  expressed fresh intent, we don't penalize it with old backoff).
- Keep the original `id` so any UI references stay stable.

**Why:** the user rapidly tapping `+` should result in one network
write at the final value, not five.

**Alternative considered:** append all writes and let them serialize.
Wastes network and rate-limits the user perceptually.

---

## D5. Collapsing into in-flight items

If a write is currently `in_flight` (HTTP request open) when a new
enqueue comes for the same key:

- **Do not** cancel the in-flight request (no AbortController in v1).
- **Append** a new `pending` item with the latest payload. After the
  in-flight item finishes, the queue will pick up the new pending
  item and process it.

**Tradeoff:** for one tap-storm the user causes 2 network writes
instead of 1. Acceptable — upserts are idempotent, last write wins at
the DB.

**Alternative considered:** wire AbortController through the Supabase
client and cancel in-flight requests on collapse. Doable but the JS
SDK doesn't expose abort cleanly across `select().eq().single()`
chains. Defer.

---

## D6. DB conflict resolution

**Locked:** replace the SELECT-then-INSERT/UPDATE pattern in the
write path with:

```ts
supabase.from("scores").upsert(
  { round_player_id, hole_number, strokes },
  { onConflict: "round_player_id,hole_number" }
)
```

**Alternative considered:** keep SELECT-then-INSERT/UPDATE, add an
application-level mutex.

**Finding discovered during Phase A implementation:** the production
`scores` table **already has** a `UNIQUE (round_player_id,
hole_number)` constraint (`scores_round_player_id_hole_number_key`),
pre-dating the `supabase/migrations/` directory and never recorded in
a migration file. Phase 2's audit missed it because `list_tables`
only surfaces PKs and FKs, not unique constraints. This means:

- The race-condition theory from Phase 1 (S1) was **structurally
  impossible** all along at the DB level. The DB would have rejected
  duplicate inserts. Zero duplicates in the audit was the constraint
  enforcing itself, not luck.
- **No new migration is needed** for Phase A. The constraint already
  satisfies `onConflict`. Phase A is just the code refactor.
- The remaining Bug 1 mechanism (Sequence D′: write fails entirely →
  optimistic state lost on remount) is **still real and still
  active.** The constraint doesn't help when no row was ever written.

Upsert is still worth shipping in Phase A: it's a single round-trip
vs the current two, idempotent under retry (which we'll need for the
queue in Phase B+), and removes a `maybeSingle()` call whose `error`
field was already being silently ignored.

A side benefit: upsert is the right semantics for the write queue —
retries are naturally idempotent.

---

## D7. Retry policy ✅ Locked (significantly revised from draft)

**Locked schedule:**

- **Backoff per item:** 1s, 2s, 4s, 8s, 16s, 30s, 60s, 120s, then
  **120s steady-state forever.**
- **No "give up after N attempts" rule during the active round.**
- **Enqueue triggers an immediate first-attempt drain (zero delay).**
  Happy path: tap → optimistic state set → queue + persisted → fire
  → 200 OK → item removed. End-to-end a few hundred ms.
- **"Stuck-too-long" terminal trigger:** if an item has been failing
  continuously for **6 hours**, mark `terminal_failure`. Surfaces on
  next app open via the prompt (D9).

**Why no give-up during the round:**

Scoring happens in bursts at the green — four players tap a flurry of
`+`/`−` taps, then walk to the next tee box. The walk between holes
can be 5–10 minutes of zero scoring activity. Cellular dead zones in
the trees behind some greens at Semiahmoo can last that long too.

Giving up after a 60-second cumulative timeout (the prior draft) is
hostile to this rhythm — the user could complete a hole, walk into a
dead zone, exit on the next tee box, and the queue has already
terminal-marked their previous hole because of the dead zone they
walked through. We'd then prompt them to manually retry something
they had no reason to know failed.

Continuous retry at 120s intervals during the round is cheap
(localStorage is free; network attempts are tiny upserts) and
robust against the actual deployment environment.

**Why 6 hours for stuck-too-long:**

Covers the realistic "user forgot to tap End Round" tail. A round
lasts 4 hours; another 2 hours of slack handles forgotten phones,
post-round beers, etc. Beyond 6 hours we assume the user has moved
on with their day, and the queue surfaces failures via the on-open
prompt the next time they open the app.

**Alternative considered (rejected):**

Original draft: 5 attempts ≈ 60s of backoff, terminal after that. Too
short for the actual scoring rhythm. Rejected.

---

## D8. Failure classification

Supabase returns `{data, error}` where `error` has a `.code` and
`.message`. Classification:

- **Retry** (transient): no `error.code` set (network/CORS/timeout),
  5xx HTTP status, `error.code === "57014"` (statement timeout),
  `PGRST*` connection errors.
- **Terminal** (don't retry): 4xx HTTP status (400 bad request,
  401/403 auth/RLS, 404 missing FK, 409 conflict — but conflict
  shouldn't fire with upsert), `23503` (FK violation, e.g.
  round_player was deleted), any error with `.code` matching
  PostgreSQL constraint violations.
- **Unknown:** treat as retry. Log to Sentry with full error context
  so we can refine classification later.

Terminal failures bubble up to the End-Round flow (D9) as red-state
items, with a tap-to-retry affordance that resets `attempts` to 0
and re-queues.

---

## D9. UI flow ✅ Locked (significantly revised from draft)

**Core principle:** during play, the queue is invisible. The app
behaves the way a non-networked scorecard would. Reconciliation is
deferred to End Round.

### During the round

- **No "saving N changes..." chip.**
- **No per-cell status indicators.**
- **No offline banner.**
- The scorecard renders optimistic state. The queue runs silently
  in the background.

Rationale: the user demographic (60–80-year-old players in mid-round
on a phone) gains nothing from real-time sync status. They tap, the
score appears, they move on. Surfacing intermediate sync state
during the round adds anxiety, not information.

### End-of-round flow

The "Finish Round ✓" tap kicks off a deterministic reconciliation
sequence:

1. **Disable the End Round button** immediately on tap, to prevent
   double-tap during the next steps.
2. **Hail-mary drain:** every pending item in the queue fires
   immediately, **regardless of its individual backoff timer.**
   Staggered ~100ms apart to avoid hammering the DB.
3. **Show "Finishing up..." spinner.**
4. **Wait up to 30 seconds total** for the drain to complete.
5. **After 15 seconds elapsed**, surface an optional **"Skip and
   finish"** button so the user can opt out if their network is
   genuinely stuck. Tapping it short-circuits straight to step 7.
6. **If the queue drains within the window** → finalize the round
   normally. No dialog. The user sees the existing summary screen.
7. **If items remain after 30 seconds or after "Skip and finish":**
   mark each remaining item `terminal_failure`. Show the
   reconciliation dialog (template below).

### First-attempt reconciliation dialog

```
N scores didn't sync

Hole 3 — Wayne H: 5
Hole 7 — Kevin I: 4
Hole 12 — Greg W: 6

[Retry sync]   [Skip and finish]
```

- **Retry sync:** trigger one more drain pass of just the terminal
  items, resetting their `attempts` counts. The spinner returns. If
  successful → close dialog and finalize round. If items still fail
  → second-attempt dialog (below).
- **Skip and finish:** close dialog and finalize the round. The
  queue keeps trying in the background; failures will resurface on
  next app open (see "Stale-failure prompt" below).

### Second-attempt reconciliation dialog

```
Still couldn't sync N scores.

Try again later when you have better signal. If this keeps
happening, contact admin.

Hole 3 — Wayne H: 5
Hole 7 — Kevin I: 4
Hole 12 — Greg W: 6

[Try Again]   [Copy details]   [Finish anyway]
```

- **Try Again:** identical to "Retry sync" from the first dialog.
- **Copy details:** copies the failed-write list to clipboard as
  plain text. Useful for the user to text the admin or to log
  themselves. Format suggestion:

  ```
  GOBS Golf — failed sync
  Round 91 — 2026-05-11

  Hole 3, Wayne H: 5 strokes
  Hole 7, Kevin I: 4 strokes
  Hole 12, Greg W: 6 strokes
  ```
- **Finish anyway:** closes the dialog and proceeds to summary. The
  queue keeps trying in the background.

### Stale-failure prompt (on app open)

On every app open of any page (homepage, scorecard, summary,
admin), check the global queue for items in `terminal_failure`
state. If any exist, show this dialog **once** per app-open:

```
N scores from your last round still need to sync.

Hole 3 — Wayne H: 5
Hole 7 — Kevin I: 4
Hole 12 — Greg W: 6

[Retry]   [View details]   [Forget]
```

- **Retry:** drain pass of the terminal items, attempts reset. If
  successful → close dialog and remove items. If still failing → no
  further auto-prompt this session; user can revisit via View
  details.
- **View details:** opens a non-blocking page showing all terminal
  items with copy-to-clipboard. User can come back to it any time.
- **Forget:** **permanently removes** items from the queue. Explicit
  opt-out — the user accepts that those scores will never sync.
  Confirmation modal before commit. After Forget, those holes are
  gone from the DB forever (the DB never received them).

### What's intentionally NOT in this flow

- No per-cell status during play.
- No countdown or "you have N seconds left to enter scores."
- No automatic admin notification on terminal failure.
- No diff display ("this is what's on your phone vs what's in the
  DB"). All terminal items are by definition writes that never
  reached the DB, so there's nothing to diff against.

---

## D10. Drain triggers

The queue drains (i.e. processes pending items whose
`next_attempt_at <= now()`) on each of:

| Trigger | Why |
|---|---|
| `enqueue()` returns | Fire immediately; happy path is "tap → optimistic state + queue + drain → DB write" with no delay. |
| `window` `online` event | Resume after network restored. |
| `document` `visibilitychange` to `visible` | App returned to foreground. |
| `window` `pageshow` event | BFCache resume; we can't always rely on visibilitychange in this case. |
| Component mount (scorecard) | Process items left over from a prior session, before `load()` rehydrates state. |
| Periodic timer, 30s | Backstop for missed events; cheap when queue is empty. |
| End Round tap (hail-mary) | Force-drain every pending item ignoring backoff. See D9. |
| Stale-failure prompt "Retry" | Force-drain terminal items with attempt counts reset. |

Drain logic:

1. Walk pending items in `enqueued_at` order.
2. For each: if `next_attempt_at > now()`, skip (still in backoff).
3. Otherwise mark `in_flight`, fire upsert, await.
4. On success: remove from queue.
5. On retryable failure: increment attempts, compute next backoff,
   mark `pending`. If attempts ≥ 8, hold at 120s steady-state. If
   the item has been failing for ≥6h continuously (i.e.
   `now() - enqueued_at >= 6h` and never succeeded), mark
   `terminal_failure` instead.
6. On terminal failure (4xx, FK violation, etc.): mark
   `terminal_failure`, leave in queue, log to Sentry.

**Hail-mary drain (D9 step 2):** same loop but **ignores
`next_attempt_at`** — every pending item is attempted exactly once
in this pass, staggered ~100ms.

Concurrency: process items serially within a single drain pass to
keep ordering predictable and avoid hammering the DB. Multiple
drain triggers firing simultaneously: guarded by a
`draining: boolean` flag — subsequent triggers are no-ops while a
pass is in progress.

---

## D11. Multi-tab handling ✅ Locked

**Locked:** no explicit coordination. Each tab maintains its own
queue. Rely on the unique-constraint upsert at the DB to make
double-drains idempotent.

**Alternative considered:** BroadcastChannel leader election.

**Rationale:** the canonical use case is one player = one phone =
one tab. Admin laptop watching live is read-only (summary,
leaderboard) and doesn't write scores. If two tabs of the same
origin somehow both wrote, the unique constraint + upsert means the
worst case is "two network writes instead of one" — no row
duplication, no data loss, no flipping between values.

Real-time live sync (admin laptop seeing player edits live) is
deferred to a hypothetical future "Phase E" with Supabase Realtime
subscriptions. That's a different design and a different decision.

---

## D12. Pre-drain on `pagehide` / `beforeunload`

**Locked:** attempt one synchronous drain pass on `pagehide`, but
treat as best-effort. Don't block unload, don't show "are you sure"
dialogs.

**Rationale:** durable queue means we don't NEED to flush before
unload. On next mount, items are still in `localStorage` and drain
there. `pagehide` drain is opportunistic — if the network is fast,
the last few items land before tab closes; if not, they wait for
next session.

**Specifically NOT doing:** `navigator.sendBeacon`. It only supports
POST with simple payloads, doesn't fit the Supabase upsert REST
shape, and bypasses auth headers we'd need to thread through.

---

## D13. Storage bounds & quota handling

Budget worst case ≪ 5MB so this should never fire, but:

- Wrap every `localStorage.setItem` in try/catch.
- On `QuotaExceededError`: evict the oldest `terminal_failure`
  items first, then oldest `pending` items, until the write
  succeeds or the queue is empty.
- Each eviction logs a Sentry warning with the evicted item's
  identity. Losing user data should never be silent.

---

## D14. Sentry instrumentation

**Log to Sentry:**

- Terminal failures (full payload + error code + attempt history).
- Storage evictions (item identity + reason).
- Drain pass crashed (uncaught exception inside the drain loop).
- Queue size exceeds 100 items at drain start (signals a stuck
  queue or a much larger problem upstream).
- Stale-failure prompt's "Forget" tap (so we know users are
  abandoning data).

**Do NOT log:** every enqueue, every successful drain, every retry.
That's normal traffic and would drown the signal.

---

## Edge cases

| Case | Behavior |
|---|---|
| Round ends (`is_complete = true`) with items still in queue | Hail-mary drain in End Round flow handles this. After finalize, queue keeps retrying. |
| `round_player_id` deleted while items pending | Upsert returns FK violation (23503). Classify terminal, surface in End Round flow or stale-failure prompt. |
| Mount with stale queue from a previous session | Drain runs BEFORE `load()`'s `setScores(scoreMap)`. Otherwise the DB rehydrate would mask the pending writes for a moment. |
| User opens the scorecard, never enters a score, navigates away | Queue is empty. No-op everywhere. |
| Tab evicted mid-`pagehide`-drain | At most one item lost from that pass; rest survive in localStorage. |
| Score = 0 reaches queue | Already clamped 1–20 in `setScore` upstream. Queue trusts the clamp; no defensive re-clamping. |
| Two writes for same key arrive in different orders | Collapsed at enqueue time before either fires. If one is in-flight, the second waits and overwrites — final value matches the last user intent. |
| `localStorage` disabled (private browsing, hardened browser) | Detect at startup via try/catch on `setItem('__test', '1')`. Fall back to in-memory queue with prominent warning banner. Users in this mode lose the durability guarantee. |
| Clock skew between client and DB | We never use client timestamps for ordering against DB rows. Local timestamps only drive backoff. Safe. |
| Network reports online but writes still 5xx | Standard retry path. 120s steady-state until 6h or End Round / stale-failure prompt resolves them. |
| Sentry quota exhausted | Don't gate UI behavior on Sentry. End-Round and stale-failure flows must work without Sentry. |
| User taps Retry in stale-failure prompt, network still down | Dialog stays open showing same items. No further auto-prompts this session; user can come back via View details when signal returns. |
| Item age = 5h59m and still failing at End Round | Hail-mary drain fires; if it still fails, item becomes terminal in the End Round flow. Doesn't have to wait for the 6h timer. |
| Phone dies mid-round, user opens app next day | Stale-failure prompt fires on next app open. Items past the 6h threshold are already terminal; remaining items continue retrying. |

---

## Testing surface

Existing infra (Phase 3): `tests/components/fake-supabase.ts` already
supports `writeDelayMs` and a `failWrite` predicate. Easy to extend
for `.upsert` and queue tests.

**Unit tests** (`tests/lib/writeQueue/`):

- enqueue → immediate drain → DB has row
- enqueue same key twice while pending → collapsed to one drain
- enqueue while in_flight for same key → new pending item; both
  fire serially
- failed write (5xx) → retries with correct backoff schedule
  (1s, 2s, 4s, 8s, 16s, 30s, 60s, 120s, 120s, 120s …) — use
  `vi.useFakeTimers`
- failed write (4xx) → marked terminal immediately, no retry
- item age ≥ 6h with continuous failure → marked terminal
- terminal item → "Retry" resets attempts to 0
- offline (`navigator.onLine = false`) → drain skipped, online
  event resumes
- pageshow event triggers drain
- quota exceeded → eviction order: terminal_failure first, then
  oldest pending
- localStorage disabled → in-memory fallback works
- hail-mary drain → ignores `next_attempt_at`, processes every
  pending item
- stagger interval ~100ms between hail-mary writes

**Component tests** (extend `scorecard-bug-repro.test.tsx`):

- Sequence A through E re-run with queue wired in — should pass
  identically (queue is transparent in happy path).
- New Sequence F: failed write + unmount + remount → on remount,
  queue drains and DB now has the value (proves Bug 1 fix).
- New Sequence G: 18 holes × 4 players entered rapid-fire with
  random network failures sprinkled — all values eventually land
  in DB.
- End-of-round dialog tests: 30s timeout fires the dialog, "Skip
  and finish" short-circuits, "Retry sync" drains terminal items.
- Stale-failure prompt test: open scorecard with terminal items
  in queue from a "previous session" → dialog renders, "Forget"
  clears.

**Manual smoke** (Vercel preview, real device):

- Enter scores with airplane mode toggling on/off mid-round.
- Background the app for >30s mid-round; reopen; confirm scores
  preserved both in UI and DB.
- Same as above but with the OS killing the tab while
  backgrounded (close all background tabs in iOS Safari, then
  reopen).
- End Round with airplane mode on: confirm 30s spinner → dialog
  → Skip and finish → finalizes → reopen → stale-failure prompt.
- Stale-failure prompt "Forget" → confirm items gone from
  storage.

---

## Implementation phases

Each phase ships independently. After each phase merges, the next
phase is approved as a fresh handoff with its own scope.

**Phase A — Upsert refactor. ✓ THIS PR.**

- No migration: the existing
  `scores_round_player_id_hole_number_key` constraint already
  satisfies `onConflict` (see D6 finding).
- Change `setScore`'s DB call from SELECT-then-INSERT/UPDATE to a
  single `.upsert({...}, { onConflict: "round_player_id,hole_number" })`.
- Update Phase 3 tests' fake to support `.upsert`. Sequences A–E
  continue to pass.
- This is a code-cleanliness + correctness improvement: single
  round-trip, idempotent, and removes an ignored `error` field on
  the existing `maybeSingle()`. Doesn't itself fix Bug 1's remaining
  active mechanism (write-failure-then-remount); that needs the
  queue (Phase B+).

**Phase B — Queue scaffolding** (separate PR, after A merges).

- `src/lib/writeQueue/` with `WriteQueue` class, `localStorage`
  persistence, enqueue / drain / collapse / retry, network event
  listeners, backoff schedule, 6h stuck-too-long timer.
- Full unit-test coverage.
- Not yet imported by the scorecard.

**Phase C — Wire into scorecard** (separate PR, after B merges).

- `setScore` enqueues instead of awaiting Supabase directly.
- Optimistic state still set synchronously.
- `load()` drains the queue *before* setting `scoreMap` into state.
- No UI indicator during play (per D9).
- Component tests updated.

**Phase D — End-of-round reconciliation flow** (separate PR, after C).

- Hail-mary drain on End Round tap.
- "Finishing up..." spinner, 30s timeout, "Skip and finish"
  affordance after 15s.
- First-attempt and second-attempt reconciliation dialogs.
- Copy-details clipboard integration.
- Component + integration tests.

**Phase E — Stale-failure prompt + app-open hook** (separate PR, after D).

- On any page mount, check global queue for `terminal_failure`
  items. If any, render the prompt once per session.
- "View details" page.
- "Forget" with confirmation modal.
- Sentry instrumentation for Forget taps.

**Phase F — Real-time multi-tab sync** (deferred, may never ship).

- Supabase Realtime subscriptions for admin laptop watching live.
- Out of scope for the bug fix; revisit if user request emerges.

---

## Explicit out-of-scope items

The following are intentionally NOT part of this design and should
not be conflated with the write queue:

- **Real-time sync between devices.** Admin laptop seeing player
  phone edits live requires Supabase Realtime subscriptions.
  Separate design, separate PR, separate decision. Tentatively
  Phase F.
- **Optimistic concurrency / version checks.** No `updated_at` row
  versioning. Last write wins.
- **Conflict resolution UI.** No "two clients edited this — choose"
  modal.
- **Offline mode for tee selection or admin tools.** Only scoring
  writes are queued; everything else continues to require online.
- **IndexedDB migration.** Defer until `localStorage` proves
  insufficient.
- **Per-user audit trail.** No "who edited this score" tracking.
  The DB only knows the final value.
- **AbortController on in-flight writes.** Cancellation is harder
  than it looks; collapse handles the practical case.
- **Sentry breadcrumbs on every queue op.** Only terminal failures
  and invariants are logged; routine ops are silent.
- **Admin notification on terminal failure.** No SMS / email /
  push to the admin when a player has stuck items. The user-side
  copy-details flow is the only path.

---

## Open questions for Jonathan

None. All four originally-flagged decisions (D2, D7, D9, D11) are
locked. This doc is now a reference, not a request.
