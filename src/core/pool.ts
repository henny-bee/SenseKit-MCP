/** How many engine/QRS requests one tool call keeps in flight. enigma
 *  multiplexes JSON-RPC over one socket, so concurrency cuts wall time
 *  without extra sessions; the bound keeps a 2,000-object app from flooding
 *  the engine (and the proxy's request queue) with one burst. */
export const ENGINE_CONCURRENCY = 8;

/** Map `fn` over `items` with at most `limit` calls in flight. Results come
 *  back in INPUT order regardless of completion order, so callers that used
 *  a sequential loop keep byte-identical output. Rejects with the first
 *  error, like Promise.all — wrap `fn` in try/catch for best-effort scans. */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  const width = Math.min(Math.max(1, Math.floor(limit) || 1), items.length);
  await Promise.all(Array.from({ length: width }, worker));
  return out;
}
