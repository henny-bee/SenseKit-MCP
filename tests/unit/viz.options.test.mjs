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
