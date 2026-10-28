import { test } from "node:test";
import assert from "node:assert/strict";
import { placeCell, checkCellPlacement, cellBox } from "../../dist/viz/layout.js";

function layout(vizs) {
  const props = { columns: 24, rows: 12, cells: [] };
  vizs.forEach((v, i) => placeCell(props, `o${i}`, v));
  return props;
}
const boxes = (props) => props.cells.map((c) => [c.col, c.row, c.colspan, c.rowspan]);
const overlaps = (props) => checkCellPlacement(props.cells.map(cellBox), props.cells.map((c) => c.name), props.columns, props.rows)
  .filter((f) => /overlap/.test(f.message));

test("uniform 8x4 tiles keep the classic layout: 3 per 4-row band", () => {
  const p = layout(["kpi", "kpi", "kpi", "barchart", "barchart"]);
  assert.deepEqual(boxes(p), [[0, 0, 8, 4], [8, 0, 8, 4], [16, 0, 8, 4], [0, 4, 8, 4], [8, 4, 8, 4]]);
  assert.deepEqual(overlaps(p), []);
});

test("a tile after a taller one takes the first free slot instead of overlapping", () => {
  const p = layout(["piechart", "kpi", "kpi", "kpi"]); // pie is 8x6
  assert.deepEqual(boxes(p)[0], [0, 0, 8, 6]);
  assert.deepEqual(overlaps(p), []);
  const last = p.cells[3];
  assert.ok(last.row >= 4 && !(last.col === 0 && last.row < 6), `placed at ${last.col},${last.row}`);
});

test("mixed tall tiles (treemap, scatterplot, piechart) never overlap", () => {
  const p = layout(["treemap", "scatterplot", "piechart", "kpi", "table", "kpi", "treemap", "linechart", "kpi", "gauge"]);
  assert.deepEqual(overlaps(p), [], JSON.stringify(boxes(p)));
  for (const c of p.cells) assert.ok(c.col + c.colspan <= p.columns, `${c.name} within columns`);
  assert.ok(p.rows >= Math.max(...p.cells.map((c) => c.row + c.rowspan)), "grid grew to fit");
});

test("re-placing an object ignores its own old cell and replaces it (one cell per object)", () => {
  const p = layout(["kpi", "kpi"]);
  placeCell(p, "o0", "kpi");
  assert.equal(p.cells.filter((c) => c.name === "o0").length, 1);
  assert.deepEqual(overlaps(p), []);
});

test("an explicit position is honoured as given and grows the grid", () => {
  const p = layout(["kpi"]);
  const { cell, grid } = placeCell(p, "big", "kpi", { col: 20, row: 10, colspan: 8, rowspan: 6 });
  assert.deepEqual([cell.col, cell.row, cell.colspan, cell.rowspan], [20, 10, 8, 6]);
  assert.deepEqual(grid, { columns: 28, rows: 16 });
  // Explicit overlaps are allowed; the lint reports them.
  placeCell(p, "dup", "kpi", { col: 0, row: 0, colspan: 8, rowspan: 4 });
  assert.equal(overlaps(p).length, 1);
});
