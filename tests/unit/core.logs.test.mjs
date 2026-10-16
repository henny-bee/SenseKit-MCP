import { test } from "node:test";
import assert from "node:assert/strict";
import { tailText } from "../../dist/core/logs.js";

// ── tailText ─────────────────────────────────────────────────────────────────

test("tailText returns the last n lines and counts what it dropped", () => {
  const log = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
  const t = tailText(log, 200);
  assert.deepEqual([t.totalLines, t.dropped, t.lines.length], [500, 300, 200]);
  assert.equal(t.lines[0], "line 301");
  assert.equal(t.lines.at(-1), "line 500");
  const short = tailText("a\r\nb", 10);
  assert.deepEqual([short.totalLines, short.dropped, short.lines], [2, 0, ["a", "b"]]);
  assert.deepEqual(tailText("", 10).totalLines, 0);
});
