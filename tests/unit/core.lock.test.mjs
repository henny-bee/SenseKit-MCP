import { test } from "node:test";
import assert from "node:assert/strict";
import { KeyedLock } from "../../dist/core/lock.js";

const tick = () => new Promise((r) => setImmediate(r));

// ── Per-app write serialization ──────────────────────────────────────────────

test("KeyedLock: one key runs one task at a time, in arrival order; other keys do not wait", async () => {
  const lock = new KeyedLock();
  const log = [];
  let releaseA;
  const a = lock.run("app1", async () => {
    log.push("a:start");
    await new Promise((r) => { releaseA = r; });
    log.push("a:end");
    return "a";
  });
  const b = lock.run("app1", async () => { log.push("b:start"); return "b"; });
  const c = lock.run("app2", async () => { log.push("c:start"); return "c"; });
  await tick(); await tick();
  assert.deepEqual(log, ["a:start", "c:start"]);
  releaseA();
  assert.deepEqual(await Promise.all([a, b, c]), ["a", "b", "c"]);
  assert.deepEqual(log, ["a:start", "c:start", "a:end", "b:start"]);
});

test("KeyedLock: a task that throws releases the key", async () => {
  const lock = new KeyedLock();
  await assert.rejects(lock.run("k", async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await lock.run("k", async () => 42), 42);
});

test("KeyedLock.byApp: serializes by args.appId and passes every argument through", async () => {
  const lock = new KeyedLock();
  let inFlight = 0;
  let peak = 0;
  const handler = lock.byApp(async (args, extra) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await tick();
    inFlight--;
    return `${args.appId}:${extra}`;
  });
  const out = await Promise.all([handler({ appId: "x" }, 1), handler({ appId: "x" }, 2), handler({ appId: "x" }, 3)]);
  assert.deepEqual(out, ["x:1", "x:2", "x:3"]);
  assert.equal(peak, 1);
});
