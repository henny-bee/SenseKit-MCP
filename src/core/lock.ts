/** Runs tasks one at a time per key, in arrival order; different keys run
 *  in parallel. A task that throws releases the key like one that returns.
 *
 *  Used to serialize writes per app: two mutating tool calls on one app
 *  interleave their read-modify-write of the sheet's cell list (one cell is
 *  lost) and their DoSave calls (the engine answers "Write Failed", and an
 *  object that was created but never saved disappears when the session
 *  closes). Hit live when a client sent builder calls in parallel. */
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

  /** `fn` wrapped so that calls with the same `args.appId` run one at a time. */
  byApp<A extends { appId: string }, Rest extends unknown[], R>(
    fn: (args: A, ...rest: Rest) => Promise<R>,
  ): (args: A, ...rest: Rest) => Promise<R> {
    return (args, ...rest) => this.run(args.appId, () => fn(args, ...rest));
  }
}
