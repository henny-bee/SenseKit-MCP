// Stores the promise so callers share one load; rejected loads are evicted.
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
