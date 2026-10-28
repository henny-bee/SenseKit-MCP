import { test } from "node:test";
import assert from "node:assert/strict";
import { VIZ_SPECS, checkVizShape } from "../../dist/viz/specs.js";
import { buildVizProps, buildFilterpaneChildren } from "../../dist/viz/props.js";
import { fixture } from "./_helpers.mjs";

test("buildVizProps: pivot gets qMode P, listbox gets qListObjectDef, text-image no cube dims", () => {
  const pivot = buildVizProps("pivot-table", "t", ["Region"], ["Sum(Sales)"]);
  assert.equal(pivot.qHyperCubeDef.qMode, "P");
  const lb = buildVizProps("listbox", "t", ["Region"], []);
  assert.ok(lb.qListObjectDef);
  assert.ok(!lb.qHyperCubeDef);
  // text-image renders authored text only — no cube, and no fabricated
  // "[Measure 1]" placeholder text (that shipped to users once).
  const ti = buildVizProps("text-image", "Hello", [], []);
  assert.equal(ti.qHyperCubeDef, undefined);
  assert.equal(ti.markdown, "Hello");
  assert.equal(checkVizShape("text-image", 0, 1)[0].severity, "fail"); // measures refused
  const bar = buildVizProps("barchart", "t", ["Region"], ["Sum(Sales)"]);
  assert.equal(bar.qHyperCubeDef.qMeasures[0].qDef.qDef, "=Sum(Sales)");
});

// ── buildVizProps: backward compatibility ────────────────────────────────────

test("buildVizProps: plain strings == equivalent spec objects, with or without empty options", () => {
  const cases = [
    ["kpi", [], ["Sum(Sales)"]], ["gauge", [], ["Sum(Sales)"]],
    ["barchart", ["Region", "Year"], ["Sum(Sales)", "=Avg(X)"]], ["linechart", ["Date"], ["Sum(S)"]],
    ["combochart", ["D"], ["Sum(A)", "Sum(B)"]], ["piechart", ["D"], ["Sum(A)"]],
    ["scatterplot", ["D"], ["Sum(A)", "Sum(B)"]], ["treemap", ["A", "B"], ["Sum(X)"]],
    ["table", ["A", "B"], ["Sum(X)"]], ["pivot-table", ["A", "B"], ["Sum(X)"]],
    ["listbox", ["A"], []], ["text-image", [], []],
  ];
  for (const [viz, d, m] of cases) {
    const plain = buildVizProps(viz, "T", d, m);
    const objs = buildVizProps(viz, "T", d.map((field) => ({ field })), m.map((expression) => ({ expression })), {});
    assert.deepEqual(objs, plain, viz);
  }
});

test("buildVizProps: plain-string barchart keeps its exact verified shape", () => {
  const bar = buildVizProps("barchart", "t", ["Region"], ["Sum(Sales)"]);
  assert.deepEqual(bar.qHyperCubeDef.qDimensions[0].qDef, {
    qFieldDefs: ["Region"], qSortCriterias: [{ qSortByLoadOrder: 1, qSortByNumeric: 1 }], autoSort: true, cId: "d1",
  });
  assert.deepEqual(bar.qHyperCubeDef.qMeasures[0].qDef, {
    qDef: "=Sum(Sales)", qLabel: "", qNumFormat: { qType: "U" }, autoSort: true, cId: "m1", numFormatFromTemplate: true,
  });
  assert.equal(bar.qHyperCubeDef.qMeasures[0].qLibraryId, undefined);
  assert.deepEqual(bar.qHyperCubeDef.qInterColumnSortOrder, [0, 1]);
});

test("buildVizProps: styling never leaks into the shared nebula defaults", () => {
  const before = buildVizProps("barchart", "t", ["R"], ["Sum(X)"]);
  buildVizProps("barchart", "t", ["R"], ["Sum(X)"], { colorMode: "single", color: "#ff0000", showLegend: false, stacked: true, showDataLabels: true });
  assert.deepEqual(buildVizProps("barchart", "t", ["R"], ["Sum(X)"]), before);
});

// ── buildVizProps: labels, master links, formats, options ────────────────────

test("buildVizProps barchart: labels, sort, master links, number format, options", () => {
  const bar = buildVizProps("barchart", "t",
    [{ field: "Region", label: "Sales region", sort: "desc" }, { libraryId: "lib-d" }],
    [{ expression: "Sum(Sales)", label: "Revenue", numberFormat: { type: "money" } }, { libraryId: "lib-m" }],
    { colorMode: "single", color: "#1f77b4", showLegend: false, showDataLabels: true, orientation: "horizontal", stacked: true, sortByMeasure: "desc" });
  const [d1, d2] = bar.qHyperCubeDef.qDimensions;
  assert.deepEqual(d1.qDef.qFieldLabels, ["Sales region"]);
  assert.deepEqual(d1.qDef.qSortCriterias, [{ qSortByNumeric: -1, qSortByAscii: -1, qSortByLoadOrder: 1 }]);
  assert.equal(d1.qDef.autoSort, false);
  assert.equal(d2.qLibraryId, "lib-d");
  assert.equal(d2.qDef.qFieldDefs, undefined); // no inline def beside the link
  assert.equal(d2.qDef.cId, "d2");
  const [m1, m2] = bar.qHyperCubeDef.qMeasures;
  assert.equal(m1.qDef.qLabel, "Revenue");
  assert.equal(m1.qDef.qNumFormat.qType, "M");
  assert.equal(m1.qDef.numFormatFromTemplate, false);
  assert.equal(m2.qLibraryId, "lib-m");
  assert.equal(m2.qDef.qDef, undefined); // library measure: no inline expression
  assert.equal(m2.qDef.cId, "m2");
  assert.deepEqual(bar.color.paletteColor, { color: "#1f77b4", index: -1 });
  assert.deepEqual([bar.color.auto, bar.color.mode], [false, "primary"]);
  assert.equal(bar.legend.show, false);
  assert.equal(bar.dataPoint.showLabels, true);
  assert.equal(bar.orientation, "horizontal");
  assert.equal(bar.barGrouping.grouping, "stacked");
  // sort by value = first measure leads the inter-column order
  assert.deepEqual(bar.qHyperCubeDef.qInterColumnSortOrder, [2, 0, 1, 3]);
  assert.equal(m1.qSortBy.qSortByNumeric, -1);
});

test("buildVizProps barchart: colorMode byDimension/byMeasure and per-measure colors", () => {
  const byDim = buildVizProps("barchart", "t", ["R"], ["Sum(X)"], { colorMode: "byDimension" });
  assert.deepEqual([byDim.color.auto, byDim.color.mode], [false, "byDimension"]);
  const byMeas = buildVizProps("barchart", "t", ["R"], ["Sum(X)"], { colorMode: "byMeasure" });
  assert.deepEqual([byMeas.color.auto, byMeas.color.mode], [false, "byMeasure"]);
  const perMeasure = buildVizProps("barchart", "t", ["R"], [{ expression: "Sum(A)", color: "#ff0000" }, "Sum(B)"]);
  assert.deepEqual(perMeasure.qHyperCubeDef.qMeasures[0].qDef.coloring, { baseColor: { color: "#ff0000", index: -1 } });
  assert.equal(perMeasure.qHyperCubeDef.qMeasures[1].qDef.coloring, undefined);
  assert.equal(perMeasure.color.useBaseColors, "measure");
});

test("buildVizProps kpi: library measure matches the client's link shape, label + format inline", () => {
  const lib = buildVizProps("kpi", "K", [], [{ libraryId: "fixture-measure-1" }]);
  // same shape as the recorded client-authored KPI fixture
  assert.deepEqual(lib.qHyperCubeDef.qMeasures, fixture("kpi_library_ref.json").qHyperCubeDef.qMeasures);
  const inline = buildVizProps("kpi", "K", [], [{ expression: "Sum(Sales)", label: "Sales", numberFormat: { type: "integer" } }]);
  const q = inline.qHyperCubeDef.qMeasures[0].qDef;
  assert.deepEqual([q.qDef, q.qLabel, q.qNumFormat.qType, q.numFormatFromTemplate], ["=Sum(Sales)", "Sales", "I", false]);
  assert.equal(inline.legend, undefined); // kpi gets no nebula chart blocks
});

test("buildVizProps table: column labels, calculated dim, sortByMeasure asc", () => {
  const t = buildVizProps("table", "T",
    [{ field: "Region", label: "Region name" }, { expression: "=Year(D)", label: "Year" }],
    [{ expression: "Sum(S)", label: "Sales", numberFormat: { type: "number", decimals: 1 } }],
    { sortByMeasure: "asc", showLegend: true });
  const [d1, d2] = t.qHyperCubeDef.qDimensions;
  assert.deepEqual(d1.qDef.qFieldLabels, ["Region name"]);
  assert.deepEqual(d2.qDef.qFieldDefs, ["=Year(D)"]);
  assert.equal(t.qHyperCubeDef.qMeasures[0].qDef.qNumFormat.qFmt, "#,##0.0");
  assert.deepEqual(t.qHyperCubeDef.qInterColumnSortOrder, [2, 0, 1]);
  assert.equal(t.qHyperCubeDef.qMeasures[0].qSortBy.qSortByNumeric, 1);
  assert.deepEqual(t.qHyperCubeDef.columnOrder, [0, 1, 2]);
});

test("buildVizProps treemap: keeps qMode K, links + labels threaded, value labels option", () => {
  const tm = buildVizProps("treemap", "TM",
    [{ libraryId: "lib-d" }, { field: "Product", label: "Prod" }],
    [{ expression: "=Sum(S)", label: "Sales", numberFormat: { type: "percent" } }],
    { showDataLabels: true, colorMode: "auto", stacked: true });
  assert.equal(tm.qHyperCubeDef.qMode, "K");
  assert.equal(tm.qHyperCubeDef.qDimensions[0].qLibraryId, "lib-d");
  assert.deepEqual(tm.qHyperCubeDef.qDimensions[1].qDef.qFieldLabels, ["Prod"]);
  const q = tm.qHyperCubeDef.qMeasures[0].qDef;
  assert.deepEqual([q.qDef, q.qLabel, q.qNumFormat.qFmt], ["Sum(S)", "Sales", "0.0%"]); // still stored without "="
  assert.equal(tm.labels.values, true);
  assert.equal(tm.color.auto, true);
  assert.equal(tm.barGrouping, undefined); // stacked is barchart-only
});

test("buildVizProps gauge: library measure + number format replace the harvested defaults", () => {
  const g = buildVizProps("gauge", "G", [], [{ libraryId: "lib-m", numberFormat: { type: "percent", decimals: 0 } }]);
  const m = g.qHyperCubeDef.qMeasures[0];
  assert.equal(m.qLibraryId, "lib-m");
  assert.equal(m.qDef.qDef, undefined);
  assert.deepEqual(m.qDef.qNumFormat, { qType: "F", qFmt: "0%", qnDec: 0, qUseThou: 0, qDec: ".", qThou: "," });
  assert.equal(g.gaugetype, "radial"); // harvested blocks intact
  const labelled = buildVizProps("gauge", "G", [], [{ expression: "Sum(X)", label: "Fill" }]);
  assert.deepEqual([labelled.qHyperCubeDef.qMeasures[0].qDef.qDef, labelled.qHyperCubeDef.qMeasures[0].qDef.qLabel], ["Sum(X)", "Fill"]);
});

test("buildVizProps pivot-table: qMode P preserved with labels, sort and links", () => {
  const p = buildVizProps("pivot-table", "P",
    [{ field: "Region", sort: "asc", label: "Reg" }, { libraryId: "lib-d" }],
    [{ libraryId: "lib-m" }, { expression: "Sum(X)", label: "X" }]);
  assert.equal(p.qHyperCubeDef.qMode, "P");
  assert.equal(p.qHyperCubeDef.qNoOfLeftDims, 2);
  const [d1, d2] = p.qHyperCubeDef.qDimensions;
  assert.deepEqual(d1.qDef.qFieldLabels, ["Reg"]);
  assert.deepEqual(d1.qDef.qSortCriterias, [{ qSortByNumeric: 1, qSortByAscii: 1, qSortByLoadOrder: 1 }]);
  assert.deepEqual(d2, { qDef: {}, qNullSuppression: false, qLibraryId: "lib-d" });
  assert.deepEqual(p.qHyperCubeDef.qMeasures[0], { qDef: {}, qLibraryId: "lib-m" });
  assert.deepEqual(p.qHyperCubeDef.qMeasures[1].qDef, { qDef: "=Sum(X)", qLabel: "X" });
});

test("buildVizProps listbox: calculated dim and master dimension", () => {
  const calc = buildVizProps("listbox", "Year", [{ expression: "Year(D)", label: "Year" }], []);
  assert.deepEqual(calc.qListObjectDef.qDef, { qFieldDefs: ["=Year(D)"], qFieldLabels: ["Year"] });
  const lib = buildVizProps("listbox", "", [{ libraryId: "lib-d" }], []);
  assert.equal(lib.qListObjectDef.qLibraryId, "lib-d");
  assert.deepEqual(lib.qListObjectDef.qDef, {});
});

// ── Filterpane ───────────────────────────────────────────────────────────────

test("buildVizProps action-button: label, background and navigation in the supernova's shape", () => {
  const b = buildVizProps("action-button", "Go to sales", [], [], { color: "#1f3a5f", navigateTo: { action: "goToSheet", sheetId: "s1" } });
  assert.equal(b.qInfo.qType, "action-button");
  assert.equal(b.visualization, "action-button");
  assert.equal(b.qHyperCubeDef, undefined);
  assert.equal(b.title, "Go to sales");
  assert.equal(b.showTitles, false);
  assert.equal(b.style.label, "Go to sales");
  assert.deepEqual(b.style.background.color, { index: -1, color: "#1f3a5f" });
  assert.deepEqual(b.navigation, { action: "goToSheet", sheet: "s1" });
  assert.deepEqual(b.actions, []);
  const plain = buildVizProps("action-button", undefined, [], []);
  assert.equal(plain.style.label, "Button");
  assert.deepEqual(plain.style.background.color, { index: -1, color: "none" });
  assert.deepEqual(plain.navigation, { action: "none" });
  assert.deepEqual(buildVizProps("action-button", "Next", [], [], { navigateTo: { action: "nextSheet" } }).navigation, { action: "nextSheet" });
  assert.deepEqual(
    buildVizProps("action-button", "Web", [], [], { navigateTo: { action: "openWebsite", url: "https://example.com" } }).navigation,
    { action: "openWebsite", websiteUrl: "https://example.com", sameWindow: false },
  );
  assert.equal(VIZ_SPECS["action-button"].renderVerified, false);
  assert.equal(checkVizShape("action-button", 1, 0)[0].severity, "fail");
});

test("filterpane: spec, parent has no cube, one listbox child per dimension", () => {
  assert.equal(VIZ_SPECS.filterpane.cube, "filterpane");
  assert.equal(VIZ_SPECS.filterpane.renderVerified, false);
  assert.equal(checkVizShape("filterpane", 0, 0)[0].severity, "fail");
  assert.equal(checkVizShape("filterpane", 2, 1)[0].severity, "fail");
  assert.equal(checkVizShape("filterpane", 20, 0).length, 0);
  const pane = buildVizProps("filterpane", "Filters", ["Region"], []);
  assert.equal(pane.qHyperCubeDef, undefined);
  assert.equal(pane.qListObjectDef, undefined);
  assert.deepEqual(pane.qChildListDef, { qData: { info: "/qInfo" } });
  assert.equal(pane.visualization, "filterpane");
  const kids = buildFilterpaneChildren(["Region", { expression: "Year(D)", label: "Year" }, { libraryId: "lib-d" }]);
  assert.equal(kids.length, 3);
  // a plain-field child is exactly the standalone (render-verified) listbox
  assert.deepEqual(kids[0], buildVizProps("listbox", "Region", ["Region"], []));
  assert.equal(kids[1].title, "Year");
  assert.deepEqual(kids[1].qListObjectDef.qDef.qFieldDefs, ["=Year(D)"]);
  assert.equal(kids[2].qListObjectDef.qLibraryId, "lib-d");
  assert.ok(kids.every((k) => k.visualization === "listbox"));
});

// ── Null and zero rows, pivot columns, combo series ─────────────────────────

test("buildVizProps: includeNulls false sets qNullSuppression on hypercube dimensions only", () => {
  const dims = [{ field: "Region", includeNulls: false }, "Product"];
  for (const viz of ["barchart", "table", "pivot-table", "treemap"]) {
    const qd = buildVizProps(viz, "t", dims, ["Sum(Sales)"]).qHyperCubeDef.qDimensions;
    assert.equal(qd[0].qNullSuppression, true, viz);
    assert.notEqual(qd[1].qNullSuppression, true, viz);
  }
  // true is the client default: the same definition as leaving it out.
  assert.deepEqual(
    buildVizProps("barchart", "t", [{ field: "Region", includeNulls: true }], ["Sum(Sales)"]),
    buildVizProps("barchart", "t", ["Region"], ["Sum(Sales)"]),
  );
  const lb = buildVizProps("listbox", "t", [{ field: "Region", includeNulls: false }], []);
  assert.equal(lb.qListObjectDef.qNullSuppression, undefined);
});

test("buildVizProps: includeZeros false sets qSuppressZero", () => {
  for (const viz of ["barchart", "combochart", "table", "pivot-table", "treemap"]) {
    const cube = buildVizProps(viz, "t", ["Region"], ["Sum(Sales)"], { includeZeros: false }).qHyperCubeDef;
    assert.equal(cube.qSuppressZero, true, viz);
  }
  assert.equal(buildVizProps("barchart", "t", ["Region"], ["Sum(Sales)"], { includeZeros: true }).qHyperCubeDef.qSuppressZero, false);
});

test("buildVizProps pivot-table: trailing pivotColumn dimensions become columns", () => {
  const cube = buildVizProps("pivot-table", "t", ["Region", { field: "Product", pivotColumn: true }, { field: "FiscalYear", pivotColumn: true }], ["Sum(Sales)"]).qHyperCubeDef;
  assert.equal(cube.qMode, "P");
  assert.equal(cube.qNoOfLeftDims, 1);
  assert.equal(buildVizProps("pivot-table", "t", ["Region", "Product"], ["Sum(Sales)"]).qHyperCubeDef.qNoOfLeftDims, 2);
  assert.throws(() => buildVizProps("pivot-table", "t", [{ field: "Region", pivotColumn: true }, "Product"], ["Sum(Sales)"]), /at least one row dimension/);
  assert.throws(() => buildVizProps("pivot-table", "t", ["Region", { field: "Product", pivotColumn: true }, "FiscalYear"], ["Sum(Sales)"]), /must come after all row dimensions/);
});

test("buildVizProps combochart: series and measure colors in the client's combo shape", () => {
  const props = buildVizProps("combochart", "t", ["Month"], [
    { expression: "Sum(Sales)", color: "#1f4e79" },
    { expression: "Sum(Margin)/Sum(Sales)", series: { type: "line", axis: "secondary" } },
  ]);
  const [m1, m2] = props.qHyperCubeDef.qMeasures;
  // Once one measure names a series, every measure gets one (default bar, primary).
  assert.deepEqual(m1.qDef.series, { type: "bar", axis: 0 });
  assert.deepEqual(m2.qDef.series, { type: "line", axis: 1 });
  assert.deepEqual(props.measureAxes.map((a) => a.dock), ["near", "far"]);
  assert.deepEqual(m1.qDef.color, { on: true, mode: "primary", paletteColor: { index: -1, color: "#1f4e79", alpha: 1 } });
  assert.equal(m1.qDef.coloring, undefined);
  assert.equal(props.color.useBaseColors, "off");
  // Everything on the primary axis: no second axis block.
  const primary = buildVizProps("combochart", "t", ["Month"], [{ expression: "Sum(A)", series: { type: "marker" } }]);
  assert.equal(primary.measureAxes, undefined);
  assert.deepEqual(primary.qHyperCubeDef.qMeasures[0].qDef.series, { type: "marker", axis: 0 });
});

// ── Client chart types built from the supernovas' own property sets ─────────

test("bulletchart: per-measure target as qDef.target plus the bullet-target attribute expression", () => {
  const b = buildVizProps("bulletchart", "t", ["Year"], [{ expression: "Sum(Sales)", target: "Sum(Budget)" }], { color: "#1f3a5f", orientation: "vertical" });
  const m = b.qHyperCubeDef.qMeasures[0];
  assert.equal(m.qDef.target, "=Sum(Budget)");
  assert.deepEqual(m.qAttributeExpressions, [{ qExpression: "=Sum(Budget)", id: "bullet-target" }]);
  assert.equal(m.qDef.useSegments, false);
  assert.equal(b.orientation, "vertical");
  assert.equal(b.color.auto, false);
  assert.deepEqual(b.color.bar, { index: -1, color: "#1f3a5f" });
  const plain = buildVizProps("bulletchart", "t", [], ["Sum(Sales)", "Sum(Cost)"]);
  assert.equal(plain.qHyperCubeDef.qMeasures[0].qDef.target, "");
  assert.deepEqual(plain.qHyperCubeDef.qMeasures[0].qAttributeExpressions, []);
  assert.equal(plain.orientation, "horizontal");
  assert.equal(plain.color.auto, true);
  assert.equal(plain.qHyperCubeDef.qSuppressZero, false);
  assert.equal(buildVizProps("bulletchart", "t", ["Rep"], ["Sum(S)"], { includeZeros: false }).qHyperCubeDef.qSuppressZero, true);
  const ranked = buildVizProps("bulletchart", "t", ["Rep"], ["Sum(S)"], { sortByMeasure: "desc", color: "#123456" });
  assert.deepEqual(ranked.qHyperCubeDef.qInterColumnSortOrder, [1, 0]);
  assert.equal(ranked.qHyperCubeDef.qMeasures[0].qSortBy.qSortByNumeric, -1);
  assert.deepEqual(ranked.color.bar, { index: -1, color: "#123456" }); // sort must not touch the bullet's colors
  assert.equal(buildVizProps("boxplot", "t", ["C"], ["Sum(S)"], { includeZeros: false }).boxplotDef.qHyperCubeDef.qSuppressZero, true);
  assert.equal(buildVizProps("distributionplot", "t", ["C"], ["Sum(S)"], { includeZeros: false }).qHyperCubeDef.qSuppressZero, true);
  // The client's data limits: a dimension allows one measure, none allows 15.
  assert.deepEqual(checkVizShape("bulletchart", 0, 15), []);
  assert.match(checkVizShape("bulletchart", 1, 2)[0].message, /exactly 1 measure/);
  assert.equal(checkVizShape("bulletchart", 0, 16)[0].severity, "fail");
});

test("boxplot: the cube lives under boxplotDef, with the client's calculation defaults", () => {
  const b = buildVizProps("boxplot", "t", ["Customer", "Year"], ["Sum(Sales)"]);
  assert.equal(b.qHyperCubeDef, undefined);
  const cube = b.boxplotDef.qHyperCubeDef;
  assert.deepEqual(cube.qDimensions.map((d) => d.qDef.qFieldDefs[0]), ["Customer", "Year"]);
  assert.equal(cube.qMeasures[0].qDef.qDef, "=Sum(Sales)");
  assert.equal(cube.qAlwaysFullyExpanded, true);
  assert.deepEqual(b.boxplotDef.calculations, { auto: true, mode: "tukey", parameters: { tukey: 1.5, fractiles: 0.01, stdDev: 3 } });
  assert.equal(b.orientation, "vertical");
  assert.deepEqual(checkVizShape("boxplot", 1, 1), []);
  assert.equal(checkVizShape("boxplot", 3, 1)[0].severity, "fail");
});

test("histogram: one dimension, no measures, automatic bins", () => {
  const h = buildVizProps("histogram", "t", ["Sales"], [], { color: "#2a9d8f", showDataLabels: true });
  assert.equal(h.qHyperCubeDef.qDimensions[0].qDef.qFieldDefs[0], "Sales");
  assert.deepEqual(h.qHyperCubeDef.qMeasures, []);
  assert.equal(h.bins.auto, true);
  assert.equal(h.bins.binMode, "maxCount");
  assert.deepEqual(h.color.bar.paletteColor, { index: -1, color: "#2a9d8f" });
  assert.equal(h.dataPoint.showLabels, true);
  assert.equal(checkVizShape("histogram", 1, 1)[0].severity, "fail");
});

test("distributionplot: tree-mode cube sorted by the second column first", () => {
  const one = buildVizProps("distributionplot", "t", ["Customer"], ["Sum(Sales)"]);
  assert.equal(one.qHyperCubeDef.qMode, "K");
  assert.deepEqual(one.qHyperCubeDef.qInterColumnSortOrder, [1, 0]);
  assert.equal(one.color.point.persistent, undefined);
  assert.equal(one.orientation, "horizontal");
  const two = buildVizProps("distributionplot", "t", ["Customer", "Year"], ["Sum(Sales)"]);
  assert.deepEqual(two.qHyperCubeDef.qInterColumnSortOrder, [1, 2, 0]);
  assert.equal(two.color.point.persistent, true);
});

test("waterfallchart: measures add, subtract or subtotal, with optional subtotal bars", () => {
  const w = buildVizProps("waterfallchart", "t", [], [
    { expression: "Sum(Sales)", label: "Sales" },
    { expression: "Sum(Cost)", label: "Cost", operation: "subtract", subtotal: "Margin" },
    { expression: "0", label: "Total", operation: "subtotal" },
  ], { showLegend: false });
  const q = w.qHyperCubeDef.qMeasures.map((m) => m.qDef);
  assert.deepEqual(q.map((d) => d.valueType), ["NORMAL", "INVERSE", "SUBTOTAL"]);
  assert.deepEqual(q[1].subtotal, { enable: true, label: "Margin" });
  assert.equal(q[0].subtotal, undefined);
  assert.equal(w.legend.show, false);
  assert.equal(w.dataPoint.showLabels, true);
  assert.equal(checkVizShape("waterfallchart", 1, 1)[0].severity, "fail");
});

test("mekkochart: two dimensions and one measure, zero rows suppressed", () => {
  const m = buildVizProps("mekkochart", "t", ["CustomerCountry", "Year"], ["Sum(Sales)"]);
  assert.equal(m.qHyperCubeDef.qDimensions.length, 2);
  assert.equal(m.qHyperCubeDef.qSuppressZero, true);
  assert.deepEqual(m.cellColor, { mode: "auto", legend: { show: "auto", showTitle: true } });
  assert.equal(checkVizShape("mekkochart", 1, 1)[0].severity, "fail");
  for (const t of ["bulletchart", "boxplot", "histogram", "distributionplot", "waterfallchart", "mekkochart"]) {
    assert.equal(VIZ_SPECS[t].renderVerified, false, t);
  }
});
