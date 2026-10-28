import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { walkStrings } from "../../dist/core/walk.js";
import { FIXTURES, fixture } from "./_helpers.mjs";

function searchQProp(prop, term) {
  const needle = term.toLowerCase();
  const found = [];
  walkStrings(prop, "", (path, s) => {
    if (s.toLowerCase().includes(needle)) found.push({ path, s });
  });
  return found;
}

test("search finds an inline expression with its qProp path", () => {
  const hits = searchQProp(fixture("barchart_expressions.json"), "Scenario={'Actual'}");
  assert.equal(hits.length, 1);
  assert.match(hits[0].path, /qHyperCubeDef\.qMeasures\[0\]\.qDef\.qDef/);
});

test("search finds a library reference and a title expression", () => {
  assert.equal(searchQProp(fixture("kpi_library_ref.json"), "fixture-measure-1").length, 1);
  const title = searchQProp(fixture("barchart_expressions.json"), "GetCurrentSelections");
  assert.match(title[0].path, /title\.qStringExpression\.qExpr/);
});

test("every shipped fixture walks cleanly and yields string leaves", () => {
  for (const f of readdirSync(FIXTURES).filter((x) => x.endsWith(".json"))) {
    let leaves = 0;
    walkStrings(fixture(f), "", () => { leaves++; });
    assert.ok(leaves > 0, `${f} produced no string leaves`);
  }
});
