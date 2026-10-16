import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDims, normalizeMeasures } from "../../dist/viz/inputs.js";

// ── Builder extensions: spec normalization ───────────────────────────────────

test("normalizeDims: strings stay fields, '=' strings become calculated dims", () => {
  assert.deepEqual(normalizeDims(["Region", "=Year(OrderDate)"]), [
    { field: "Region" }, { expression: "=Year(OrderDate)" },
  ]);
  assert.deepEqual(normalizeDims(), []);
});

test("normalizeDims: object forms, '=' added to expressions, idempotent", () => {
  const n = normalizeDims([
    { field: "Region", label: "Sales region", sort: "desc" },
    { expression: "Year(OrderDate)" },
    { libraryId: "lib-dim-1" },
  ]);
  assert.deepEqual(n, [
    { field: "Region", label: "Sales region", sort: "desc" },
    { expression: "=Year(OrderDate)" },
    { libraryId: "lib-dim-1" },
  ]);
  assert.deepEqual(normalizeDims(n), n); // normalized specs are valid input
});

test("normalizeDims: exactly-one-of and value errors name the offending item", () => {
  assert.throws(() => normalizeDims([{ label: "x" }]), /dimensions\[0\]: exactly one of field, expression, libraryId is required \(got none\)/);
  assert.throws(() => normalizeDims(["A", { field: "B", libraryId: "L" }]), /dimensions\[1\]: .*\(got field, libraryId\)/);
  assert.throws(() => normalizeDims([{ field: "  " }]), /field must be a non-empty string/);
  assert.throws(() => normalizeDims([""]), /dimensions\[0\]: empty field name/);
  assert.throws(() => normalizeDims([{ field: "=Year(D)" }]), /pass it as expression/);
  assert.throws(() => normalizeDims([{ field: "A", sort: "random" }]), /sort must be one of asc, desc, loadOrder/);
});

test("normalizeMeasures: strings, objects, and their errors", () => {
  assert.deepEqual(normalizeMeasures(["Sum(Sales)"]), [{ expression: "Sum(Sales)" }]);
  assert.deepEqual(
    normalizeMeasures([{ libraryId: "lib-m", numberFormat: { type: "percent" }, color: "#1F77B4" }]),
    [{ libraryId: "lib-m", numberFormat: { type: "percent" }, color: "#1F77B4" }],
  );
  assert.throws(() => normalizeMeasures([{ label: "x" }]), /measures\[0\]: exactly one of expression, libraryId is required \(got none\)/);
  assert.throws(() => normalizeMeasures([{ expression: "Sum(X)", libraryId: "L" }]), /got expression, libraryId/);
  assert.throws(() => normalizeMeasures(["  "]), /measures\[0\]: empty expression/);
  assert.throws(() => normalizeMeasures(["="]), /empty expression/);
  assert.throws(() => normalizeMeasures([{ expression: "Sum(X)", color: "red" }]), /measures\[0\]: color must be a hex color/);
  assert.throws(() => normalizeMeasures([{ expression: "Sum(X)", numberFormat: { type: "custom" } }]), /measures\[0\]: .*custom" needs a pattern/);
  assert.throws(() => normalizeMeasures([{ expression: "Sum(X)", numberFormat: { type: "number", decimals: 16 } }]), /decimals must be an integer 0-15/);
});
