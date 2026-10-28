import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSelectValues } from "../../dist/qix/selection.js";

test("buildSelectValues: numbers and numeric strings become duals", () => {
  const [n, s, t, e] = buildSelectValues([120, "150", "East", ""]);
  assert.deepEqual(n, { qText: "120", qIsNumeric: true, qNumber: 120 });
  assert.deepEqual(s, { qText: "150", qIsNumeric: true, qNumber: 150 });
  assert.deepEqual(t, { qText: "East", qIsNumeric: false });
  assert.deepEqual(e, { qText: "", qIsNumeric: false });
});
