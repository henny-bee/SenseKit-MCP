import { test } from "node:test";
import assert from "node:assert/strict";
import { mapPool, ENGINE_CONCURRENCY } from "../../dist/core/pool.js";

// Deterministic "random" delays: a fixed LCG, so a failure reproduces.
function delays(n, seed = 7) {
  let s = seed;
  return Array.from({ length: n }, () => (s = (s * 1103515245 + 12345) % 2 ** 31) % 6);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tracked(ms) {
  const t = { inFlight: 0, maxInFlight: 0, completed: [] };
  t.fn = async (item, i) => {
    t.inFlight++;
    t.maxInFlight = Math.max(t.maxInFlight, t.inFlight);
    await sleep(ms[i]);
    t.inFlight--;
    t.completed.push(i);
    return item * 10;
  };
  return t;
}

test("ENGINE_CONCURRENCY is a small positive bound", () => {
  assert.equal(ENGINE_CONCURRENCY, 8);
});

test("mapPool: results come back in input order whatever the completion order", async () => {
  const items = Array.from({ length: 40 }, (_, i) => i);
  const t = tracked(delays(items.length));
  const out = await mapPool(items, 5, t.fn);
  assert.deepEqual(out, items.map((i) => i * 10));
  assert.notDeepEqual(t.completed, items, "delays should have scrambled completion order");
  assert.deepEqual([...t.completed].sort((a, b) => a - b), items);
});

test("mapPool: never more than `limit` calls in flight, and the bound is used", async () => {
  for (const limit of [1, 3, 8]) {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const t = tracked(delays(items.length, limit));
    await mapPool(items, limit, t.fn);
    assert.ok(t.maxInFlight <= limit, `limit ${limit}: saw ${t.maxInFlight} in flight`);
    assert.equal(t.maxInFlight, limit, `limit ${limit}: pool should fill up`);
  }
});

test("mapPool: empty input returns [] without calling fn", async () => {
  let calls = 0;
  assert.deepEqual(await mapPool([], 4, async () => { calls++; }), []);
  assert.equal(calls, 0);
});

test("mapPool: limit <= 0 or NaN behaves as 1 (sequential)", async () => {
  for (const limit of [0, -3, NaN]) {
    const items = [1, 2, 3, 4];
    const t = tracked([3, 0, 2, 1]);
    const out = await mapPool(items, limit, t.fn);
    assert.deepEqual(out, [10, 20, 30, 40]);
    assert.equal(t.maxInFlight, 1, `limit ${limit}`);
    assert.deepEqual(t.completed, [0, 1, 2, 3], `limit ${limit}: sequential completion`);
  }
});

test("mapPool: limit larger than the item count is fine", async () => {
  const t = tracked([2, 0, 1]);
  assert.deepEqual(await mapPool([1, 2, 3], 100, t.fn), [10, 20, 30]);
  assert.equal(t.maxInFlight, 3);
});

test("mapPool: passes the index and rejects with the first error, like Promise.all", async () => {
  const seen = [];
  await assert.rejects(
    mapPool(["a", "b", "c", "d"], 2, async (item, i) => {
      seen.push([item, i]);
      await sleep(i === 1 ? 1 : 3);
      if (item === "b") throw new Error("boom b");
      if (item === "d") throw new Error("boom d");
      return item;
    }),
    /boom b/,
  );
  assert.deepEqual(seen.slice(0, 2), [["a", 0], ["b", 1]]);
  await sleep(15); // let the remaining workers drain before the test ends
});
