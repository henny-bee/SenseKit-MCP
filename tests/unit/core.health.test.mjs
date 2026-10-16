import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeHealthcheck } from "../../dist/core/health.js";

// ── summarizeHealthcheck ─────────────────────────────────────────────────────

test("summarizeHealthcheck flattens the operator numbers, keeps raw", () => {
  const h = {
    version: "12.1877.6", started: "20260806T120000.000Z", saturated: false,
    mem: { committed: 1024.5, allocated: 900, free: 14000 },
    cpu: { total: 3 },
    session: { active: 1, total: 2 },
    apps: { active_docs: ["a"], loaded_docs: ["a", "b"], in_memory_docs: ["a", "b"], calls: 42, selections: 7 },
    users: { active: 1, total: 1 },
  };
  const s = summarizeHealthcheck(h);
  assert.equal(s.saturated, false);
  assert.equal(s.memFreeMB, 14000);
  assert.deepEqual([s.apps.activeDocs, s.apps.loadedDocs], [1, 2]);
  assert.equal(s.raw.version, "12.1877.6");
  // Some engine builds return counts, not arrays — both shapes must survive.
  const s2 = summarizeHealthcheck({ apps: { active_docs: 3 } });
  assert.equal(s2.apps.activeDocs, 3);
});
