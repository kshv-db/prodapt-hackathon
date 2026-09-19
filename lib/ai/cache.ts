/** Tiny in-memory TTL cache (best effort per server instance). */
export function ttlCache<T>(ttlMs: number, maxEntries: number) {
  const store = new Map<string, { value: T; expires: number }>();
  return {
    get(key: string, now = Date.now()): T | undefined {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expires <= now) {
        store.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key: string, value: T, now = Date.now()): void {
      if (store.size >= maxEntries) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
      store.set(key, { value, expires: now + ttlMs });
    },
    clear: () => store.clear(),
  };
}
