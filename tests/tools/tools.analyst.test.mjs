// Analyst group, engine query tools: data model, expressions with their
// trust envelope (warnings + active selections), hypercubes, field values,
// selections and the total-vs-groups crosscheck.
//
// Fake data (tests/helpers/fake-engine.mjs): Sales East 10+20, West 30+40;
// Products Widget (East+West), Gadget (East), Gizmo (West).

import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, ok, expectToolError, expectInvalidArgs, APP_ID } from "../helpers/harness.mjs";

let h;
before(async () => { h = await startServer({ groups: ["analyst"], allowMutations: false }); });
after(() => h.close());
beforeEach(() => h.doc.selections.clear());

const select = (field, values, extra = {}) => h.callApp("select_field_values", { field, values, ...extra });

describe("analyst: app discovery", () => {
  test("list_engine_apps lists docs in the paging envelope", async () => {
    const body = ok(await h.call("list_engine_apps"));
    assert.equal(body.total, 1);
    assert.equal(body.items[0].id, APP_ID);
    assert.equal(body.items[0].name, "Fake Sales");
    assert.ok("lastReload" in body.items[0] && "fileSizeBytes" in body.items[0]);
  });

  test("get_app_data_model returns tables with fields and cardinality", async () => {
    const body = ok(await h.callApp("get_app_data_model"));
    assert.equal(body.title, "Fake Sales");
    assert.equal(body.tables.length, 1);
    assert.equal(body.tables[0].name, "Sales");
    assert.equal(body.tables[0].rows, 4);
    const region = body.tables[0].fields.find((f) => f.name === "Region");
    assert.equal(region.cardinality, 2);
  });

  test("an unknown app is a tool error; a non-GUID appId is rejected by the schema", async () => {
    expectToolError(await h.call("get_app_data_model", { appId: "deadbeef-0000-0000-0000-000000000000" }), { code: "ENGINE_ERROR", messageIncludes: "deadbeef" });
    expectInvalidArgs(await h.call("get_app_data_model", { appId: "Sales.qvf" }), "appId");
  });
});

describe("analyst: evaluate_expression", () => {
  test("evaluates and stamps the (empty) selection context", async () => {
    const body = ok(await h.callApp("evaluate_expression", { expression: "Sum(Sales)" }));
    assert.equal(body.expression, "Sum(Sales)");
    assert.equal(Number(body.value), 100);
    assert.equal(body.isNumeric, true);
    assert.deepEqual(body.activeSelections, []);
    assert.equal(body.warnings, undefined);
  });

  test("honours current selections and reports them", async () => {
    ok(await select("Region", ["East"]));
    const body = ok(await h.callApp("evaluate_expression", { expression: "Sum(Sales)" }));
    assert.equal(Number(body.value), 30);
    assert.deepEqual(body.activeSelections.map((s) => [s.field, s.selectedCount]), [["Region", 1]]);
  });

  test("a misspelled field evaluates (to 0) but carries an unknown-field warning", async () => {
    const body = ok(await h.callApp("evaluate_expression", { expression: "Sum(Salse)" }));
    assert.equal(Number(body.value), 0);
    assert.equal(body.warnings.length, 1);
    assert.match(body.warnings[0], /unknown field.*Salse/);
  });

  test("a syntax error is flagged as an expression error", async () => {
    const body = ok(await h.callApp("evaluate_expression", { expression: "Sum((Sales)" }));
    assert.ok(body.warnings.some((w) => /expression error/i.test(w)), JSON.stringify(body.warnings));
  });
});

describe("analyst: create_hypercube", () => {
  test("group-by returns columns, typed rows and the selection context", async () => {
    const body = ok(await h.callApp("create_hypercube", { dimensions: ["Region"], measures: ["Sum(Sales)"] }));
    assert.deepEqual(body.columns, ["Region", "Sum(Sales)"]);
    assert.equal(body.totalRows, 2);
    assert.equal(body.returnedRows, 2);
    assert.deepEqual(body.rows, [["East", 30], ["West", 70]]);
    assert.deepEqual(body.activeSelections, []);
    assert.equal(body.warnings, undefined);
  });

  test("sortByMeasureDesc orders by the measure, descending", async () => {
    const body = ok(await h.callApp("create_hypercube", { dimensions: ["Product"], measures: ["Sum(Sales)"], sortByMeasureDesc: 0 }));
    assert.deepEqual(body.rows.map((r) => r[1]), [40, 40, 20]);
    assert.equal(body.rows[2][0], "Gadget");
  });

  test("maxRows caps returned rows while totalRows stays honest", async () => {
    const body = ok(await h.callApp("create_hypercube", { dimensions: ["Product"], measures: ["Sum(Sales)"], maxRows: 1 }));
    assert.equal(body.returnedRows, 1);
    assert.equal(body.totalRows, 3);
  });

  test("respects selections", async () => {
    ok(await select("Region", ["West"]));
    const body = ok(await h.callApp("create_hypercube", { dimensions: ["Product"], measures: ["Sum(Sales)"] }));
    assert.deepEqual(body.rows, [["Gizmo", 40], ["Widget", 30]]);
    assert.equal(body.activeSelections[0].field, "Region");
  });

  test("unknown dimension fields and measure fields produce warnings, not silence", async () => {
    const body = ok(await h.callApp("create_hypercube", { dimensions: ["Regoin"], measures: ["Sum(Salse)"] }));
    assert.ok(body.warnings.some((w) => w.includes('dimension "Regoin"')), JSON.stringify(body.warnings));
    assert.ok(body.warnings.some((w) => w.includes('measure "Sum(Salse)"')), JSON.stringify(body.warnings));
  });

  test("measures-only cube returns one total row", async () => {
    const body = ok(await h.callApp("create_hypercube", { dimensions: [], measures: ["Sum(Sales)", "Count(distinct Product)"] }));
    assert.deepEqual(body.rows, [[100, 3]]);
  });

  test("input validation", async () => {
    expectInvalidArgs(await h.callApp("create_hypercube", { dimensions: ["Region"] }), "measures");
    expectInvalidArgs(await h.callApp("create_hypercube", { dimensions: [], measures: ["Sum(Sales)"], maxRows: 0 }), "maxRows");
    expectInvalidArgs(await h.callApp("create_hypercube", { dimensions: [], measures: ["Sum(Sales)"], maxRows: 10001 }), "maxRows");
  });
});

describe("analyst: field values and selections", () => {
  test("get_field_values lists values with selection state", async () => {
    let body = ok(await h.callApp("get_field_values", { field: "Region" }));
    assert.equal(body.field, "Region");
    assert.equal(body.cardinality, 2);
    assert.deepEqual(body.values, [{ value: "East", state: "O" }, { value: "West", state: "O" }]);
    ok(await select("Region", ["East"]));
    body = ok(await h.callApp("get_field_values", { field: "Region" }));
    assert.equal(body.values.find((v) => v.value === "East").state, "S");
  });

  test("get_field_values supports searchTerm and maxValues", async () => {
    const search = ok(await h.callApp("get_field_values", { field: "Product", searchTerm: "wid" }));
    assert.deepEqual(search.values.map((v) => v.value), ["Widget"]);
    const capped = ok(await h.callApp("get_field_values", { field: "Product", maxValues: 2 }));
    assert.equal(capped.values.length, 2);
  });

  test("select_field_values on a text field selects by text", async () => {
    const body = ok(await select("Region", ["East"]));
    assert.deepEqual(body.requested, ["East"]);
    assert.equal(body.applied, true);
    assert.equal(body.mode, "text");
    assert.equal(body.selectedCount, 1);
    assert.deepEqual([...h.doc.selections.get("Region")], ["East"]);
  });

  test("numbers and numeric strings are sent as duals and match a numeric field", async () => {
    const body = ok(await select("Sales", [10, "20"]));
    assert.equal(body.mode, "numeric-dual");
    assert.equal(body.selectedCount, 2);
  });

  test("numeric-looking values in a TEXT field fall back to a text match", async () => {
    const body = ok(await select("FiscalYear", ["2026"]));
    assert.equal(body.mode, "text-fallback");
    assert.equal(body.selectedCount, 1);
    assert.deepEqual([...h.doc.selections.get("FiscalYear")], ["2026"]);
  });

  test("a value that matches nothing reports selectedCount 0", async () => {
    const body = ok(await select("Region", ["North"]));
    assert.equal(body.selectedCount, 0);
  });

  test("toggle adds to the existing selection", async () => {
    ok(await select("Product", ["Widget"]));
    const body = ok(await select("Product", ["Gizmo"], { toggle: true }));
    assert.equal(body.selectedCount, 2);
  });

  test("get_current_selections and clear_selections (one field, then all)", async () => {
    assert.deepEqual(ok(await h.callApp("get_current_selections")), []);
    ok(await select("Region", ["East"]));
    ok(await select("Product", ["Widget"]));
    const sel = ok(await h.callApp("get_current_selections"));
    assert.deepEqual(sel.map((s) => s.field).sort(), ["Product", "Region"]);
    assert.deepEqual(sel.find((s) => s.field === "Region"), { field: "Region", selectedCount: 1, selected: "East" });

    assert.match(ok(await h.callApp("clear_selections", { field: "Region" })), /Region/);
    assert.deepEqual([...h.doc.selections.keys()], ["Product"]);
    assert.match(ok(await h.callApp("clear_selections")), /all/i);
    assert.equal(h.doc.selections.size, 0);
  });

  test("select_field_values validates its values", async () => {
    expectInvalidArgs(await h.callApp("select_field_values", { field: "Region", values: [{ x: 1 }] }), "values");
  });
});

describe("analyst: crosscheck_expression", () => {
  test("an additive measure is consistent: total equals the sum of groups", async () => {
    const body = ok(await h.callApp("crosscheck_expression", { expression: "Sum(Sales)", groupBy: "Region" }));
    assert.equal(body.total, 100);
    assert.equal(body.sumOfGroups, 100);
    assert.equal(body.groupCount, 2);
    assert.equal(body.delta, 0);
    assert.equal(body.consistent, true);
    assert.deepEqual(body.activeSelections, []);
  });

  test("Count(distinct) over an overlapping dimension is flagged non-additive", async () => {
    const body = ok(await h.callApp("crosscheck_expression", { expression: "Count(distinct Product)", groupBy: "Region" }));
    assert.equal(body.total, 3);
    assert.equal(body.sumOfGroups, 4);
    assert.equal(body.delta, -1);
    assert.equal(body.consistent, false);
    assert.match(body.interpretation, /NOT/);
  });

  test("a non-numeric total is never 'consistent'", async () => {
    const body = ok(await h.callApp("crosscheck_expression", { expression: "Only(Region)", groupBy: "Region" }));
    assert.equal(body.consistent, false);
  });

  test("groupBy is required", async () => {
    expectInvalidArgs(await h.callApp("crosscheck_expression", { expression: "Sum(Sales)" }), "groupBy");
  });
});
