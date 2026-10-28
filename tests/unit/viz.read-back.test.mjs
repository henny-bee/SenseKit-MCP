import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVizProps } from "../../dist/viz/props.js";
import { specsFromProps, measureSpecFromDef } from "../../dist/viz/read-back.js";

test("specsFromProps round-trips what buildVizProps wrote", () => {
  const dims = [{ field: "Region", label: "Reg", sort: "desc" }, { expression: "=Year(D)" }, { libraryId: "lib-d" }];
  const meas = [
    { expression: "Sum(S)", label: "Sales", numberFormat: { type: "money" }, color: "#ff0000" },
    { libraryId: "lib-m", numberFormat: { type: "percent" } },
  ];
  for (const viz of ["barchart", "table", "pivot-table"]) {
    const props = buildVizProps(viz, "t", dims.slice(0, 2), meas);
    const back = specsFromProps(props);
    assert.deepEqual(buildVizProps(viz, "t", back.dimensions, back.measures), props, viz);
  }
  const tm = buildVizProps("treemap", "t", dims, [meas[0]]);
  const back = specsFromProps(tm);
  assert.deepEqual(buildVizProps("treemap", "t", back.dimensions, back.measures), tm);
  const lb = specsFromProps(buildVizProps("listbox", "", [{ libraryId: "lib-d" }], []));
  assert.deepEqual(lb, { dimensions: [{ libraryId: "lib-d" }], measures: [] });
  assert.throws(() => specsFromProps({ qHyperCubeDef: { qMeasures: [{ qDef: {} }] } }), /pass measures explicitly/);
});

test("specsFromProps round-trips null suppression, pivot columns, combo series and combo colors", () => {
  const cases = [
    ["barchart", [{ field: "Region", includeNulls: false }], ["Sum(S)"]],
    ["treemap", [{ field: "Region", includeNulls: false }, "Product"], ["Sum(S)"]],
    ["pivot-table", ["Region", { field: "Year", pivotColumn: true, includeNulls: false }], ["Sum(S)"]],
    ["combochart", ["Month"], [{ expression: "Sum(S)", color: "#123456" }, { expression: "Avg(M)", series: { type: "line", axis: "secondary" } }]],
  ];
  for (const [viz, d, m] of cases) {
    const props = buildVizProps(viz, "t", d, m);
    const back = specsFromProps(props);
    assert.deepEqual(buildVizProps(viz, "t", back.dimensions, back.measures), props, viz);
  }
  // Harvested shape of a client-authored combo chart measure.
  const client = { qDef: { qDef: "Sum(S)", series: { type: "marker", axis: 0 }, color: { on: true, mode: "primary", paletteColor: { index: -1, color: "#00cf40", alpha: 1 } } } };
  assert.deepEqual(measureSpecFromDef(client), { expression: "Sum(S)", color: "#00cf40", series: { type: "marker", axis: "primary" } });
});

test("measureSpecFromDef and cubeDefOf: bullet targets, waterfall operations and the boxplot's nested cube", async () => {
  const { cubeDefOf } = await import("../../dist/viz/read-back.js");
  const bullet = buildVizProps("bulletchart", "t", [], [{ expression: "Sum(S)", target: "Sum(B)" }]);
  assert.equal(measureSpecFromDef(bullet.qHyperCubeDef.qMeasures[0]).target, "=Sum(B)");
  const w = buildVizProps("waterfallchart", "t", [], [
    { expression: "Sum(S)" }, { expression: "Sum(C)", operation: "subtract", subtotal: "Margin" }, { expression: "0", operation: "subtotal" },
  ]);
  const back = w.qHyperCubeDef.qMeasures.map((m) => measureSpecFromDef(m));
  assert.equal(back[0].operation, undefined);
  assert.equal(back[1].operation, "subtract");
  assert.equal(back[1].subtotal, "Margin");
  assert.equal(back[2].operation, "subtotal");
  const box = buildVizProps("boxplot", "t", ["Customer"], ["Sum(S)"]);
  assert.equal(cubeDefOf(box), box.boxplotDef.qHyperCubeDef);
  const bar = buildVizProps("barchart", "t", ["Region"], ["Sum(S)"]);
  assert.equal(cubeDefOf(bar), bar.qHyperCubeDef);
});
