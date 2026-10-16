import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCellPlacement } from "../../dist/viz/layout.js";

test("checkCellPlacement catches unplaced, orphan, off-grid, overlap", () => {
  const f = checkCellPlacement(
    [
      { name: "a", col: 0, row: 0, colspan: 8, rowspan: 4 },
      { name: "a2", col: 4, row: 2, colspan: 8, rowspan: 4 },  // overlaps a
      { name: "ghost", col: 0, row: 8, colspan: 4, rowspan: 2 }, // orphan
      { name: "b", col: 20, row: 10, colspan: 8, rowspan: 4 },   // off-grid (24x12)
    ],
    ["a", "a2", "b", "unplaced"],
    24, 12,
  );
  const msgs = f.map((x) => x.message).join(" | ");
  assert.match(msgs, /unplaced has no cell/);
  assert.match(msgs, /ghost which is not a child/);
  assert.match(msgs, /exceeds the 24x12 grid/);
  assert.match(msgs, /overlap/);
  const clean = checkCellPlacement([{ name: "a", col: 0, row: 0, colspan: 8, rowspan: 4 }], ["a"], 24, 12);
  assert.equal(clean.length, 0);
});
