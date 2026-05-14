// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStorage, DEFAULT_STORAGE_KEY } from "@/lib/writeQueue/storage";
import type { QueueItem } from "@/lib/writeQueue/types";

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "id-" + Math.random().toString(36).slice(2),
    kind: "score_upsert",
    payload: { round_id: 1, round_player_id: 100, hole_number: 1, strokes: 4 },
    enqueued_at: 1_000_000,
    attempts: 0,
    last_attempt_at: null,
    next_attempt_at: 1_000_000,
    state: "pending",
    display: { player_name: "Alice", hole_label: "Hole 1" },
    ...overrides,
  };
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe("writeQueue/storage", () => {
  it("round-trips items through localStorage", () => {
    const s = createStorage();
    expect(s.isPersistent()).toBe(true);
    const items = [makeItem(), makeItem({ payload: { round_id: 1, round_player_id: 101, hole_number: 2, strokes: 5 } })];
    s.save(items);
    const loaded = createStorage().load();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].payload.round_player_id).toBe(100);
    expect(loaded[1].payload.round_player_id).toBe(101);
  });

  it("uses the locked global namespace key by default", () => {
    const s = createStorage();
    s.save([makeItem()]);
    expect(globalThis.localStorage.getItem(DEFAULT_STORAGE_KEY)).not.toBeNull();
  });

  it("returns empty list when storage key is empty/malformed", () => {
    expect(createStorage().load()).toEqual([]);
    globalThis.localStorage.setItem(DEFAULT_STORAGE_KEY, "not json");
    expect(createStorage().load()).toEqual([]);
    globalThis.localStorage.setItem(DEFAULT_STORAGE_KEY, '{"not":"array"}');
    expect(createStorage().load()).toEqual([]);
  });

  it("falls back to in-memory when storage throws on probe", () => {
    const throwing: Storage = {
      ...globalThis.localStorage,
      setItem: () => {
        throw Object.assign(new Error("blocked"), { name: "SecurityError" });
      },
    } as Storage;
    const s = createStorage({ storage: throwing });
    expect(s.isPersistent()).toBe(false);
    s.save([makeItem()]);
    expect(s.load()).toHaveLength(1);
    // Second instance with same throwing storage starts empty (in-memory only).
    expect(createStorage({ storage: throwing }).load()).toEqual([]);
  });

  it("evicts terminal_failure items first on quota exceeded, then oldest pending", () => {
    let attempts = 0;
    const onEvict = vi.fn();
    const items = [
      makeItem({ id: "a", enqueued_at: 1, state: "terminal_failure" }),
      makeItem({ id: "b", enqueued_at: 2, state: "pending" }),
      makeItem({ id: "c", enqueued_at: 3, state: "terminal_failure" }),
      makeItem({ id: "d", enqueued_at: 4, state: "pending" }),
    ];
    // Throws QuotaExceededError until exactly 2 items remain (evict 2x).
    const quotaError = Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    const fake: Storage = {
      ...globalThis.localStorage,
      getItem: (k: string) => globalThis.localStorage.getItem(k),
      removeItem: (k: string) => globalThis.localStorage.removeItem(k),
      setItem: (k: string, v: string) => {
        // Probe writes (small) succeed; payload writes throw until size is small enough.
        const parsed = (() => {
          try { return JSON.parse(v); } catch { return null; }
        })();
        if (!Array.isArray(parsed)) {
          // probe path
          globalThis.localStorage.setItem(k, v);
          return;
        }
        attempts += 1;
        if (parsed.length > 2) throw quotaError;
        globalThis.localStorage.setItem(k, v);
      },
    } as unknown as Storage;
    const s = createStorage({ storage: fake, onEvict });
    s.save(items);
    expect(onEvict).toHaveBeenCalledTimes(2);
    // First eviction: terminal at index 0 ("a"). Second eviction: next terminal in
    // the working copy ("c", which was at original index 2).
    expect(onEvict.mock.calls.map(c => c[0].id)).toEqual(["a", "c"]);
    expect(onEvict.mock.calls.map(c => c[1])).toEqual(["quota_evict_terminal", "quota_evict_terminal"]);
    expect(attempts).toBe(3); // 1 initial fail + 1 still-failing + 1 success
  });

  it("falls back to oldest pending when no terminal items left", () => {
    const onEvict = vi.fn();
    const quotaError = Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    const items = [
      makeItem({ id: "old", enqueued_at: 10, state: "pending" }),
      makeItem({ id: "newer", enqueued_at: 20, state: "pending" }),
      makeItem({ id: "newest", enqueued_at: 30, state: "pending" }),
    ];
    const fake: Storage = {
      ...globalThis.localStorage,
      getItem: (k: string) => globalThis.localStorage.getItem(k),
      removeItem: (k: string) => globalThis.localStorage.removeItem(k),
      setItem: (k: string, v: string) => {
        const parsed = (() => { try { return JSON.parse(v); } catch { return null; } })();
        if (!Array.isArray(parsed)) {
          globalThis.localStorage.setItem(k, v);
          return;
        }
        if (parsed.length > 2) throw quotaError;
        globalThis.localStorage.setItem(k, v);
      },
    } as unknown as Storage;
    const s = createStorage({ storage: fake, onEvict });
    s.save(items);
    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict.mock.calls[0][0].id).toBe("old");
    expect(onEvict.mock.calls[0][1]).toBe("quota_evict_pending");
  });
});
