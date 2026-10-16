import { test } from "node:test";
import assert from "node:assert/strict";
import { indexPropertyTree } from "../../dist/qix/objects.js";

const node = (qId, children) => ({
  qProperty: { qInfo: { qId, qType: qId.split("-")[0] }, title: `t-${qId}` },
  ...(children ? { qChildren: children } : {}),
});

test("indexPropertyTree: maps every descendant id to its qProperty, excluding the root", () => {
  const tree = node("sheet-1", [
    node("barchart-1"),
    node("filterpane-1", [node("listbox-1"), node("listbox-2")]),
  ]);
  const idx = indexPropertyTree(tree);
  assert.deepEqual([...idx.keys()].sort(), ["barchart-1", "filterpane-1", "listbox-1", "listbox-2"]);
  assert.ok(!idx.has("sheet-1"), "root excluded");
  assert.equal(idx.get("listbox-2").title, "t-listbox-2");
  assert.equal(idx.get("filterpane-1"), tree.qChildren[1].qProperty, "the qProperty itself, not a copy");
});

test("indexPropertyTree: nests to any depth", () => {
  let leaf = node("obj-10");
  for (let i = 9; i >= 1; i--) leaf = node(`obj-${i}`, [leaf]);
  const idx = indexPropertyTree(node("sheet-1", [leaf]));
  assert.equal(idx.size, 10);
  assert.ok(idx.has("obj-10"));
});

test("indexPropertyTree: no children (or an empty list) gives an empty map", () => {
  assert.equal(indexPropertyTree(node("sheet-1")).size, 0);
  assert.equal(indexPropertyTree(node("sheet-1", [])).size, 0);
});
