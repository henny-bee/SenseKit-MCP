import { test } from "node:test";
import assert from "node:assert/strict";
import { qrsQuote } from "../../dist/core/qrs-filter.js";

// ── qrsQuote: filter-value escaping ──────────────────────────────────────────

test("qrsQuote escapes quotes and backslashes for QRS filters", () => {
  assert.equal(qrsQuote("Everyone"), "Everyone");
  assert.equal(qrsQuote("O'Brien's Stream"), "O\\'Brien\\'s Stream");
  assert.equal(qrsQuote("back\\slash"), "back\\\\slash");
});
