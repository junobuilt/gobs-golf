## Locked patterns

Patterns the codebase reuses across surfaces. When you're building a new
surface that touches the same problem space, port the pattern rather than
inventing a new one.

### Per-player write queue
When a UI surface writes to `round_players` rows in response to user taps
(check-in, team assignment, Manage Team, etc.), port the queue pattern
from `src/app/admin/tabs/RoundSetup.tsx` — see the May 10 session log
entry "admin read + write-race fix" in ROADMAP.md for context.

Shape:
- `useRef<Map<player_id, Promise<void>>>` keyed by player_id
- `enqueuePlayerWrite(playerId, fn)` chains the write onto that player's
  promise so writes for the same player serialize, while cross-player
  writes still run in parallel
- `drainWrites()` awaits all queued writes; call it before any route
  change, reload, or sheet close that depends on the writes being
  durable

Why: rapid tap patterns (check player in → assign to team) can fire
INSERT and UPDATE near-simultaneously. Without serialization the UPDATE
can match 0 rows silently and team assignments are lost.

Surfaces using this pattern: `RoundSetup.tsx`, `src/app/page.tsx` (team
formation), `src/app/scorecard/page.tsx` (Manage Team).
