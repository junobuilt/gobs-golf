// D1 + D2 (locked): single global localStorage key. Synchronous, atomic
// per key, fits well under the 5MB origin budget.
// D13: quota handling evicts terminal_failure items first, then oldest
// pending. On every eviction the caller is notified so it can log to
// Sentry (D14).
// Edge case: localStorage disabled (private browsing, hardened browsers,
// SSR). Falls back to an in-memory map and reports isPersistent() = false
// so the consumer can warn the user.

import type { QueueItem } from "./types";

export interface QueueStorage {
  load(): QueueItem[];
  save(items: QueueItem[]): void;
  isPersistent(): boolean;
}

export const DEFAULT_STORAGE_KEY = "gobs:write-queue:v1";

export interface CreateStorageOptions {
  /** Override the storage key (mostly for tests). */
  key?: string;
  /** Inject a Storage implementation (mostly for tests). */
  storage?: Storage;
  /** Called once per item evicted to satisfy a QuotaExceededError. */
  onEvict?: (item: QueueItem, reason: "quota_evict_terminal" | "quota_evict_pending") => void;
}

export function createStorage(opts: CreateStorageOptions = {}): QueueStorage {
  const key = opts.key ?? DEFAULT_STORAGE_KEY;
  const onEvict = opts.onEvict ?? (() => {});
  const candidate = opts.storage ?? defaultLocalStorage();
  const ls = candidate && probeWritable(candidate, key) ? candidate : null;

  if (!ls) {
    let mem: QueueItem[] = [];
    return {
      load: () => [...mem],
      save: (items: QueueItem[]) => {
        mem = [...items];
      },
      isPersistent: () => false,
    };
  }

  return {
    load(): QueueItem[] {
      try {
        const raw = ls.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as QueueItem[]) : [];
      } catch {
        return [];
      }
    },
    save(items: QueueItem[]): void {
      const tryWrite = (snapshot: QueueItem[]): boolean => {
        try {
          ls.setItem(key, JSON.stringify(snapshot));
          return true;
        } catch (err) {
          if (isQuotaError(err)) return false;
          throw err;
        }
      };
      if (tryWrite(items)) return;
      const working = [...items];
      while (working.length > 0) {
        const terminalIdx = working.findIndex(i => i.state === "terminal_failure");
        let evictIdx: number;
        let reason: "quota_evict_terminal" | "quota_evict_pending";
        if (terminalIdx >= 0) {
          evictIdx = terminalIdx;
          reason = "quota_evict_terminal";
        } else {
          // No terminal items left — evict oldest pending.
          evictIdx = working
            .map((item, ix) => ({ item, ix }))
            .reduce((a, b) => (a.item.enqueued_at <= b.item.enqueued_at ? a : b)).ix;
          reason = "quota_evict_pending";
        }
        const [evicted] = working.splice(evictIdx, 1);
        onEvict(evicted, reason);
        if (tryWrite(working)) return;
      }
    },
    isPersistent: () => true,
  };
}

function defaultLocalStorage(): Storage | undefined {
  if (typeof globalThis === "undefined") return undefined;
  try {
    return (globalThis as { localStorage?: Storage }).localStorage;
  } catch {
    return undefined;
  }
}

function probeWritable(s: Storage, baseKey: string): boolean {
  try {
    const probeKey = baseKey + ":__probe";
    s.setItem(probeKey, "1");
    s.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: number };
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014
  );
}
