// Serializes per-app writes: parallel edits lose sheet cells and DoSave fails.
export class KeyedLock {
  private tails = new Map<string, Promise<void>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => { release = r; });
    const tail = previous.then(() => mine);
    this.tails.set(key, tail);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  byApp<A extends { appId: string }, Rest extends unknown[], R>(
    fn: (args: A, ...rest: Rest) => Promise<R>,
  ): (args: A, ...rest: Rest) => Promise<R> {
    return (args, ...rest) => this.run(args.appId, () => fn(args, ...rest));
  }
}
