import { test } from "node:test";
import assert from "node:assert/strict";
import { badFieldSubstrings } from "../../dist/qix/quality.js";

test("badFieldSubstrings maps engine ranges to the offending text", () => {
  const expr = "Sum(Salse) + Count(Region)";
  assert.deepEqual(badFieldSubstrings(expr, [{ qFrom: 4, qCount: 5 }]), ["Salse"]);
  assert.deepEqual(badFieldSubstrings(expr, []), []);
});
