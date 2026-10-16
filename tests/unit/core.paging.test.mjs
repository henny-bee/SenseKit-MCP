import { test } from "node:test";
import assert from "node:assert/strict";
import { paginate } from "../../dist/core/paging.js";

// ── paginate ─────────────────────────────────────────────────────────────────

test("paginate envelope: defaults, offset/limit, truncated flag", () => {
  const items = Array.from({ length: 250 }, (_, i) => i);
  const d = paginate(items);
  assert.deepEqual([d.total, d.offset, d.returned, d.truncated], [250, 0, 100, true]);
  const p2 = paginate(items, 240, 100);
  assert.deepEqual([p2.returned, p2.truncated, p2.items[0]], [10, false, 240]);
  const all = paginate([1, 2, 3], 0, 100);
  assert.equal(all.truncated, false);
});
