import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, ok, expectToolError, expectInvalidArgs } from "../helpers/harness.mjs";
import { seedApp } from "../helpers/seed.mjs";

async function refusedWithoutSideEffects(h, name, args, expectation) {
  const measures = h.doc.measures.size, dimensions = h.doc.dimensions.size, saves = h.doc.saves;
  const e = expectToolError(await h.callApp(name, args), expectation);
  assert.equal(h.doc.measures.size, measures, "no measure created/deleted");
  assert.equal(h.doc.dimensions.size, dimensions, "no dimension created/deleted");
  assert.equal(h.doc.saves, saves, "app not saved");
  return e;
}

describe("master: create_master_measure", () => {
  let h;
  before(async () => { h = await startServer({ groups: ["developer"] }); });
  after(() => h.close());

  test("creates a measure (leading '=' stripped, label defaults to title) and saves", async () => {
    const body = ok(await h.callApp("create_master_measure", { title: "Revenue", expression: "=Sum(Sales)", tags: ["fin"], description: "Gross" }));
    assert.equal(body.title, "Revenue");
    assert.equal(body.label, "Revenue");
    assert.equal(body.expression, "Sum(Sales)");
    assert.equal(body.numFormat, undefined);
    const stored = h.doc.measures.get(body.measureId);
    assert.ok(stored, "measure exists in the app");
    assert.equal(stored.qMeasure.qDef, "Sum(Sales)");
    assert.equal(stored.qMeasure.qLabel, "Revenue");
    assert.deepEqual(stored.qMetaDef, { title: "Revenue", description: "Gross", tags: ["fin"] });
    assert.ok(h.doc.saves > 0);
  });

  test("applies a number format", async () => {
    const body = ok(await h.callApp("create_master_measure", { title: "Margin", expression: "Avg(Sales)", label: "Margin %", numberFormat: { type: "percent", decimals: 2 } }));
    assert.equal(body.label, "Margin %");
    assert.equal(body.numFormat.qFmt, "0.00%");
    assert.equal(h.doc.measures.get(body.measureId).qMeasure.qNumFormat.qFmt, "0.00%");
  });

  test("refuses an unknown field, a syntax error, an empty expression, a duplicate title and a bad format", async () => {
    await refusedWithoutSideEffects(h, "create_master_measure", { title: "X", expression: "Sum(Salse)" }, { code: "VALIDATION_REFUSED", messageIncludes: ["refusing", "Salse"], details: { expression: "Sum(Salse)" } });
    await refusedWithoutSideEffects(h, "create_master_measure", { title: "X", expression: "Sum((Sales)" }, { code: "VALIDATION_REFUSED", messageIncludes: ["refusing", "expression error"] });
    await refusedWithoutSideEffects(h, "create_master_measure", { title: "X", expression: " = " }, { code: "INVALID_INPUT", messageIncludes: ["refusing", "empty"] });
    await refusedWithoutSideEffects(h, "create_master_measure", { title: "revenue", expression: "Sum(Sales)" }, { code: "CONFLICT", messageIncludes: ["refusing", "already exists"] });
    await refusedWithoutSideEffects(h, "create_master_measure", { title: "X", expression: "Sum(Sales)", numberFormat: { type: "custom" } }, { code: "INVALID_INPUT", messageIncludes: ["refusing", "pattern"] });
  });

  test("schema rejects empty title and unknown number-format keys", async () => {
    expectInvalidArgs(await h.callApp("create_master_measure", { title: "", expression: "Sum(Sales)" }), "title");
    expectInvalidArgs(await h.callApp("create_master_measure", { title: "Y", expression: "Sum(Sales)", numberFormat: { type: "money", currency: "EUR" } }), "numberFormat");
  });
});

describe("master: create_master_dimension", () => {
  let h;
  before(async () => { h = await startServer({ groups: ["developer"] }); });
  after(() => h.close());

  test("single-field dimension: label defaults to title", async () => {
    const body = ok(await h.callApp("create_master_dimension", { title: "Geo", fields: ["Region"] }));
    assert.equal(body.grouping, "single");
    assert.deepEqual(body.fields, ["Region"]);
    assert.deepEqual(body.labels, ["Geo"]);
    const stored = h.doc.dimensions.get(body.dimensionId);
    assert.equal(stored.qDim.qGrouping, "N");
    assert.deepEqual(stored.qDim.qFieldDefs, ["Region"]);
  });

  test("drill-down: one level per field, label renames only the top level", async () => {
    const body = ok(await h.callApp("create_master_dimension", { title: "Geo drill", fields: ["Region", "Product"], label: "Geography" }));
    assert.equal(body.grouping, "drill-down");
    assert.deepEqual(body.labels, ["Geography", "Product"]);
    assert.equal(h.doc.dimensions.get(body.dimensionId).qDim.qGrouping, "H");
  });

  test("calculated fields are checked with the engine", async () => {
    const body = ok(await h.callApp("create_master_dimension", { title: "Year", fields: ["=Year(OrderDate)"] }));
    assert.deepEqual(h.doc.dimensions.get(body.dimensionId).qDim.qFieldDefs, ["=Year(OrderDate)"]);
    await refusedWithoutSideEffects(h, "create_master_dimension", { title: "Bad year", fields: ["=Year(OrderDat)"] }, { code: "VALIDATION_REFUSED", messageIncludes: ["refusing", "OrderDat"] });
  });

  test("refuses unknown fields and duplicate titles", async () => {
    await refusedWithoutSideEffects(h, "create_master_dimension", { title: "Bad", fields: ["Region", "Nope"] }, { code: "NOT_FOUND", messageIncludes: ["refusing", "Nope"], details: { missingFields: ["Nope"] } });
    await refusedWithoutSideEffects(h, "create_master_dimension", { title: "GEO", fields: ["Region"] }, { code: "CONFLICT", messageIncludes: ["refusing", "already exists"] });
  });

  test("schema: at least one field", async () => {
    expectInvalidArgs(await h.callApp("create_master_dimension", { title: "Empty", fields: [] }), "fields");
  });
});

describe("master: delete_master_item", () => {
  let h, ids;
  before(async () => {
    h = await startServer({ groups: ["developer"] });
    ids = await seedApp(h.doc);
  });
  after(() => h.close());

  test("deletes an unreferenced item", async () => {
    const created = ok(await h.callApp("create_master_measure", { title: "Unused", expression: "Count(Product)" }));
    const body = ok(await h.callApp("delete_master_item", { kind: "measure", id: created.measureId }));
    assert.equal(body.deleted, created.measureId);
    assert.equal(body.kind, "measure");
    assert.equal(body.title, "Unused");
    assert.equal(body.forced, false);
    assert.deepEqual(body.brokenReferences, []);
    assert.ok(!h.doc.measures.has(created.measureId));
  });

  test("refuses to delete a linked item and names the linking objects and sheet", async () => {
    const e = await refusedWithoutSideEffects(h, "delete_master_item", { kind: "measure", id: ids.measureId }, { code: "REFERENCED", messageIncludes: ["refusing", ids.barId, "Overview"], details: { kind: "measure", id: ids.measureId } });
    assert.match(e.message, /force/);
    assert.ok(h.doc.measures.has(ids.measureId));
  });

  test("force: true deletes and reports the references it broke", async () => {
    const body = ok(await h.callApp("delete_master_item", { kind: "dimension", id: ids.dimensionId, force: true }));
    assert.equal(body.forced, true);
    assert.equal(body.brokenReferences.length, 1);
    const ref = body.brokenReferences[0];
    assert.equal(ref.objectId, ids.barId);
    assert.equal(ref.sheetId, ids.sheetId);
    assert.ok(ref.paths.some((p) => p.endsWith("qLibraryId")));
    assert.ok(!h.doc.dimensions.has(ids.dimensionId));
  });

  test("an unknown id, or the wrong kind, is refused", async () => {
    await refusedWithoutSideEffects(h, "delete_master_item", { kind: "measure", id: "measure-404" }, { code: "NOT_FOUND", messageIncludes: "not found", details: { kind: "measure", id: "measure-404" } });
    await refusedWithoutSideEffects(h, "delete_master_item", { kind: "dimension", id: ids.measureId }, { code: "NOT_FOUND", messageIncludes: "not found" });
    expectInvalidArgs(await h.callApp("delete_master_item", { kind: "variable", id: "x" }), "kind");
  });

  test("references held by a filterpane's listbox children are attributed to the pane's sheet", async () => {
    const dim = ok(await h.callApp("create_master_dimension", { title: "Products", fields: ["Product"] }));
    const pane = ok(await h.callApp("add_sheet_object", {
      sheetId: ids.sheetId, visualization: "filterpane", dimensions: [{ libraryId: dim.dimensionId }],
      position: { col: 0, row: 6, colspan: 6, rowspan: 6 },
    }));
    await refusedWithoutSideEffects(h, "delete_master_item", { kind: "dimension", id: dim.dimensionId }, { code: "REFERENCED", messageIncludes: ["refusing", "Overview"] });
    const forced = ok(await h.callApp("delete_master_item", { kind: "dimension", id: dim.dimensionId, force: true }));
    const ref = forced.brokenReferences[0];
    assert.equal(ref.parentId, pane.objectId);
    assert.equal(ref.sheetId, ids.sheetId);
  });
});
