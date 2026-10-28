import { test } from "node:test";
import assert from "node:assert/strict";
import { TtlCache } from "../../dist/core/cache.js";

function clock(start = 1_000) {
  const c = { t: start, now: () => c.t, advance: (ms) => { c.t += ms; } };
  return c;
}
function loader(prefix = "v") {
  const l = { calls: 0 };
  l.load = async () => `${prefix}${++l.calls}`;
  return l;
}

test("TtlCache: a second get within the TTL does not call load", async () => {
  const c = clock();
  const cache = new TtlCache(5_000, c.now);
  const l = loader();
  assert.equal(await cache.get("k", l.load), "v1");
  c.advance(4_999);
  assert.equal(await cache.get("k", l.load), "v1");
  assert.equal(l.calls, 1);
});

test("TtlCache: reloads once the TTL has passed", async () => {
  const c = clock();
  const cache = new TtlCache(5_000, c.now);
  const l = loader();
  await cache.get("k", l.load);
  c.advance(5_000);
  assert.equal(await cache.get("k", l.load), "v2");
  assert.equal(l.calls, 2);
});

test("TtlCache: concurrent gets share one in-flight load", async () => {
  const cache = new TtlCache(5_000, clock().now);
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const load = async () => { calls++; await gate; return "shared"; };
  const pending = [cache.get("k", load), cache.get("k", load), cache.get("k", load)];
  release();
  assert.deepEqual(await Promise.all(pending), ["shared", "shared", "shared"]);
  assert.equal(calls, 1);
});

test("TtlCache: a rejected load is evicted, so the next get retries", async () => {
  const cache = new TtlCache(5_000, clock().now);
  let calls = 0;
  const flaky = async () => { calls++; if (calls === 1) throw new Error("transient"); return "ok"; };
  await assert.rejects(cache.get("k", flaky), /transient/);
  assert.equal(await cache.get("k", flaky), "ok");
  assert.equal(await cache.get("k", flaky), "ok");
  assert.equal(calls, 2);
});

test("TtlCache: keys are independent; clear() drops everything", async () => {
  const c = clock();
  const cache = new TtlCache(5_000, c.now);
  const a = loader("a"), b = loader("b");
  assert.equal(await cache.get("a", a.load), "a1");
  assert.equal(await cache.get("b", b.load), "b1");
  c.advance(3_000);
  assert.equal(await cache.get("a", a.load), "a1");
  assert.equal(a.calls, 1);
  assert.equal(b.calls, 1);
  cache.clear();
  assert.equal(await cache.get("a", a.load), "a2");
  assert.equal(await cache.get("b", b.load), "b2");
});
