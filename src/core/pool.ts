// enigma multiplexes one socket; the cap stops big apps flooding the engine.
export const ENGINE_CONCURRENCY = 8;

// Results keep input order; rejects on the first error, like Promise.all.
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
