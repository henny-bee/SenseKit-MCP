import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveVizOptions } from "../../dist/viz/options.js";

// ── Options applicability ────────────────────────────────────────────────────

test("resolveVizOptions: inapplicable options are dropped and reported", () => {
  const r = resolveVizOptions("kpi", { showLegend: true, orientation: "horizontal", color: "#123456" }, [], [{ expression: "x", color: "#fff" }]);
  assert.deepEqual(r.applied, {});
  assert.equal(r.notes.length, 4);
  assert.ok(r.notes.some((n) => /showLegend does not apply to kpi/.test(n)));
  assert.ok(r.notes.some((n) => /per-measure colors do not apply to kpi/.test(n)));
  const pie = resolveVizOptions("piechart", { stacked: true, sortByMeasure: "desc" }, [{ field: "A" }], [{ expression: "x" }]);
  assert.deepEqual(pie.applied, { sortByMeasure: "desc" });
  assert.match(pie.notes[0], /stacked does not apply to piechart/);
});

test("resolveVizOptions: color rules", () => {
  assert.throws(() => resolveVizOptions("barchart", { colorMode: "single" }, [], []), /needs options.color/);
  assert.throws(() => resolveVizOptions("barchart", { color: "blue" }, [], []), /hex color/);
  const implied = resolveVizOptions("barchart", { color: "#abc" }, [], []);
  assert.deepEqual(implied.applied, { colorMode: "single", color: "#abc" });
  assert.match(implied.notes[0], /applied as colorMode "single"/);
  const unused = resolveVizOptions("barchart", { colorMode: "byDimension", color: "#abc" }, [], []);
  assert.deepEqual(unused.applied, { colorMode: "byDimension" });
  assert.match(unused.notes[0], /only used with colorMode "single"/);
  const overridden = resolveVizOptions("barchart", { colorMode: "byDimension" }, [], [{ expression: "x", color: "#fff" }]);
  assert.equal(overridden.measureColors, false);
  assert.match(overridden.notes[0], /per-measure colors ignored/);
  const libLabel = resolveVizOptions("barchart", {}, [{ libraryId: "d", label: "x" }], [{ libraryId: "m", label: "y" }]);
  assert.equal(libLabel.notes.length, 2);
});

test("resolveVizOptions: includeNulls, pivotColumn, series and includeZeros are reported where they do not apply", () => {
  const bar = resolveVizOptions("barchart", { includeZeros: false }, [{ field: "A", pivotColumn: true }], [{ expression: "Sum(X)", series: { type: "line" } }]);
  assert.equal(bar.applied.includeZeros, false);
  assert.ok(bar.notes.some((n) => /pivotColumn only applies to pivot-table/.test(n)));
  assert.ok(bar.notes.some((n) => /series only applies to combochart/.test(n)));
  const lb = resolveVizOptions("listbox", {}, [{ field: "A", includeNulls: false }], []);
  assert.ok(lb.notes.some((n) => /includeNulls does not apply to listbox/.test(n)));
  const kpi = resolveVizOptions("kpi", { includeZeros: false }, [], [{ expression: "Sum(X)" }]);
  assert.ok(kpi.notes.some((n) => /includeZeros does not apply to kpi/.test(n)));
  assert.equal(kpi.applied.includeZeros, undefined);
  // An extension gets the generic hypercube, so includeNulls applies to it.
  assert.deepEqual(resolveVizOptions("my-extension", {}, [{ field: "A", includeNulls: false }], []).notes, []);
});
