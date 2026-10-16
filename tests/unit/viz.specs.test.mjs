import { test } from "node:test";
import assert from "node:assert/strict";
import { checkVizShape } from "../../dist/viz/specs.js";

// ── UI builder validation logic ──────────────────────────────────────────────

test("checkVizShape enforces per-type dimension/measure counts", () => {
  assert.equal(checkVizShape("kpi", 0, 1).length, 0);
  assert.equal(checkVizShape("kpi", 1, 1)[0].severity, "fail");        // kpi takes no dims
  assert.equal(checkVizShape("piechart", 1, 1).length, 0);
  assert.equal(checkVizShape("scatterplot", 1, 1)[0].severity, "fail"); // needs 2-3 measures
  assert.equal(checkVizShape("made-up-viz", 0, 0)[0].severity, "warn"); // unknown type = warn, not fail
});
