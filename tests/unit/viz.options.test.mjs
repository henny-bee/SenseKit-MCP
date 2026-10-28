import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveVizOptions } from "../../dist/viz/options.js";

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

test("resolveVizOptions: navigateTo applies to action-button only and needs its target", () => {
  const btn = resolveVizOptions("action-button", { color: "#123456", navigateTo: { action: "goToSheet", sheetId: "s1", url: "https://x.example" } }, [], []);
  assert.equal(btn.applied.colorMode, "single");
  assert.equal(btn.applied.color, "#123456");
  assert.deepEqual(btn.applied.navigateTo, { action: "goToSheet", sheetId: "s1", url: "https://x.example" });
  assert.ok(btn.notes.some((n) => /navigateTo.url only applies to action "openWebsite"/.test(n)));
  assert.throws(() => resolveVizOptions("action-button", { navigateTo: { action: "goToSheet" } }, [], []), /needs sheetId/);
  assert.throws(() => resolveVizOptions("action-button", { navigateTo: { action: "openWebsite", url: "javascript:alert(1)" } }, [], []), /needs url/);
  assert.equal(resolveVizOptions("action-button", { navigateTo: { action: "openWebsite", url: "mailto:a@b.example" } }, [], []).notes.length, 0);
  const bar = resolveVizOptions("barchart", { navigateTo: { action: "nextSheet" } }, [], []);
  assert.equal(bar.applied.navigateTo, undefined);
  assert.ok(bar.notes.some((n) => /navigateTo does not apply to barchart/.test(n)));
  const byDim = resolveVizOptions("action-button", { colorMode: "byDimension" }, [], []);
  assert.equal(byDim.applied.colorMode, undefined);
  assert.ok(byDim.notes.some((n) => /does not apply to action-button/.test(n)));
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

test("resolveVizOptions: target, operation and subtotal apply to their chart types only; color modes per type", () => {
  const bar = resolveVizOptions("barchart", {}, [{ field: "A" }], [{ expression: "Sum(X)", target: "Sum(Y)", operation: "subtract", subtotal: "S" }]);
  assert.ok(bar.notes.some((n) => /target only applies to bulletchart/.test(n)));
  assert.ok(bar.notes.some((n) => /operation only applies to waterfallchart/.test(n)));
  assert.ok(bar.notes.some((n) => /subtotal only applies to waterfallchart/.test(n)));
  assert.deepEqual(resolveVizOptions("bulletchart", {}, [], [{ expression: "Sum(X)", target: "Sum(Y)" }]).notes, []);
  assert.deepEqual(resolveVizOptions("waterfallchart", {}, [], [{ expression: "Sum(X)", operation: "subtract", subtotal: "S" }]).notes, []);
  const bullet = resolveVizOptions("bulletchart", { colorMode: "byMeasure", orientation: "vertical" }, [], [{ expression: "Sum(X)" }]);
  assert.equal(bullet.applied.colorMode, undefined);
  assert.equal(bullet.applied.orientation, "vertical");
  assert.ok(bullet.notes.some((n) => /"byMeasure" does not apply to bulletchart/.test(n)));
});
