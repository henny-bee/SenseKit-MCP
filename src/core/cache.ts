/** Small per-process TTL cache for slow, rarely-changing lookups (e.g. the
 *  installed-extension list behind every validation). Stores the PROMISE, so
 *  concurrent callers share one in-flight load; a load that rejects is
 *  evicted, so a transient failure is never cached. `now` is injectable for
 *  tests. */
export class TtlCache<K, V> {
  private entries = new Map<K, { at: number; value: Promise<V> }>();

  constructor(private ttlMs: number, private now: () => number = Date.now) {}

  get(key: K, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const value = load();
    const entry = { at: this.now(), value };
    this.entries.set(key, entry);
    value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}
