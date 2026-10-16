import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVizProps } from "../../dist/viz/props.js";
import { specsFromProps } from "../../dist/viz/read-back.js";

// ── Reading specs back (update_sheet_object) ─────────────────────────────────

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
