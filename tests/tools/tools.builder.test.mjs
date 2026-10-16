// UI builder (developer group): sheets, visualization objects and the
// render-validation gate. Contract under test: what ends up in the app
// (objects, children, cells, grid) and what the gate reports, plus every
// pre-flight refusal leaving the app untouched.

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, ok, expectToolError, expectInvalidArgs } from "../helpers/harness.mjs";
import { seedApp } from "../helpers/seed.mjs";

/** Object ids that are direct children of a sheet in the fake app. */
const childrenOf = (h, sheetId) => h.doc.objects.get(sheetId).children;
const cellsOf = (h, sheetId) => h.doc.objects.get(sheetId).props.cells ?? [];
const gridOf = (h, sheetId) => {
  const p = h.doc.objects.get(sheetId).props;
  return { columns: p.columns, rows: p.rows };
};

async function newSheet(h, title = "Sheet") {
  return ok(await h.callApp("create_sheet", { title })).sheetId;
}

/** A refusal must not create, change or save anything. */
async function refusedWithoutSideEffects(h, name, args, expectation) {
  const snapshot = JSON.stringify([...h.doc.objects]);
  const saves = h.doc.saves;
  const e = expectToolError(await h.callApp(name, args), expectation);
  assert.equal(JSON.stringify([...h.doc.objects]), snapshot, "app objects unchanged");
  assert.equal(h.doc.saves, saves, "app not saved");
  return e;
}

describe("builder: validate_sheet (read-only gate)", () => {
  let h, ids;
  before(async () => {
    h = await startServer({ groups: ["developer"], allowMutations: false });
    ids = await seedApp(h.doc);
  });
  after(() => h.close());

  test("registers without mutations and reports per-object verdicts", async () => {
    const body = ok(await h.callApp("validate_sheet", { sheetId: ids.sheetId }));
    assert.equal(body.sheetId, ids.sheetId);
    assert.deepEqual(body.grid, { columns: 24, rows: 12 });
    assert.equal(body.objectCount, 3);
    assert.deepEqual(body.placementFindings, []);
    const status = Object.fromEntries(body.objects.map((o) => [o.objectId, o.status]));
    // The hand-seeded bar chart lacks the nebula default blocks: it would
    // render blank, and the gate must say so.
    assert.equal(status[ids.barId], "fail");
    assert.ok(body.objects.find((o) => o.objectId === ids.barId).findings.some((f) => /nebula/.test(f.message)));
    assert.equal(status[ids.kpiId], "pass");
    // Installed extensions (from QRS) count as known visualizations.
    assert.equal(status[ids.extId], "pass");
    assert.equal(body.verdict, "FAIL");
  });

  test("single-object mode", async () => {
    const body = ok(await h.callApp("validate_sheet", { objectId: ids.kpiId }));
    assert.equal(body.objectId, ids.kpiId);
    assert.equal(body.visualization, "kpi");
    assert.equal(body.status, "pass");
  });

  test("an unreadable object is a failing verdict, not a crash", async () => {
    const body = ok(await h.callApp("validate_sheet", { objectId: "ghost" }));
    assert.equal(body.status, "fail");
    assert.match(body.findings[0].message, /unreadable/);
  });

  test("placement lint: unplaced child, orphan cell and off-grid cell", async () => {
    const sheet = await h.doc.api.getObject(ids.sheetId);
    const props = await sheet.getProperties();
    const saved = JSON.parse(JSON.stringify(props));
    props.cells = [
      { name: ids.barId, type: "barchart", col: 20, row: 0, colspan: 8, rowspan: 4 }, // off-grid
      { name: "orphan", type: "kpi", col: 0, row: 8, colspan: 2, rowspan: 2 },
    ];
    await sheet.setProperties(props);
    try {
      const body = ok(await h.callApp("validate_sheet", { sheetId: ids.sheetId }));
      const msgs = body.placementFindings.map((f) => `${f.severity}: ${f.message}`);
      assert.ok(msgs.some((m) => m.startsWith("fail") && m.includes(ids.kpiId) && /no cell/.test(m)), msgs.join("\n"));
      assert.ok(msgs.some((m) => m.startsWith("warn") && /orphan/.test(m)), msgs.join("\n"));
      assert.ok(msgs.some((m) => m.startsWith("fail") && /exceeds/.test(m)), msgs.join("\n"));
      assert.equal(body.verdict, "FAIL");
    } finally {
      await sheet.setProperties(saved);
    }
  });

  test("needs a sheetId or an objectId", async () => {
    expectToolError(await h.callApp("validate_sheet", {}), { code: "INVALID_INPUT", messageIncludes: ["sheetId", "objectId"] });
  });
});

describe("builder: gate falls back when GetFullPropertyTree is unavailable", () => {
  test("validate_sheet and delete_master_item give the same answers via the per-object path", async () => {
    const results = [];
    for (const objectOverrides of [undefined, { getFullPropertyTree: async () => { throw new Error("not supported"); } }]) {
      const h = await startServer({ groups: ["developer"], engineOptions: { objectOverrides } });
      try {
        const ids = await seedApp(h.doc);
        const gate = ok(await h.callApp("validate_sheet", { sheetId: ids.sheetId }));
        const refusal = expectToolError(await h.callApp("delete_master_item", { kind: "measure", id: ids.measureId }), { code: "REFERENCED", messageIncludes: ["refusing", ids.barId, "Overview"] });
        results.push({ gate, refusal: refusal.message });
      } finally {
        await h.close();
      }
    }
    assert.deepEqual(results[1], results[0]);
  });
});

describe("builder: create_sheet", () => {
  let h;
  before(async () => { h = await startServer({ groups: ["developer"] }); });
  after(() => h.close());

  test("creates an empty sheet with the default grid and saves", async () => {
    const body = ok(await h.callApp("create_sheet", { title: "Overview", description: "KPIs" }));
    assert.equal(body.title, "Overview");
    assert.deepEqual(body.grid, { columns: 24, rows: 12 });
    const rec = h.doc.objects.get(body.sheetId);
    assert.equal(rec.props.qInfo.qType, "sheet");
    assert.equal(rec.props.qMetaDef.title, "Overview");
    assert.deepEqual(rec.children, []);
    assert.ok(h.doc.saves > 0);
    const sheets = ok(await h.callApp("validate_sheet", { sheetId: body.sheetId }));
    assert.equal(sheets.verdict, "PASS");
  });

  test("custom grid within limits; out-of-range grid rejected", async () => {
    const body = ok(await h.callApp("create_sheet", { title: "Wide", columns: 48, rows: 24 }));
    assert.deepEqual(body.grid, { columns: 48, rows: 24 });
    expectInvalidArgs(await h.callApp("create_sheet", { title: "Too wide", columns: 49 }), "columns");
  });
});

describe("builder: add_sheet_object", () => {
  let h, sheetId, ids;
  before(async () => {
    h = await startServer({ groups: ["developer"] });
    ids = await seedApp(h.doc);
    sheetId = await newSheet(h, "Build");
  });
  after(() => h.close());

  test("a bar chart from master items + an inline formatted measure, styled, passes the gate", async () => {
    const body = ok(await h.callApp("add_sheet_object", {
      sheetId, visualization: "barchart", title: "Revenue by region",
      dimensions: [{ libraryId: ids.dimensionId, label: "ignored" }],
      measures: [{ libraryId: ids.measureId }, { expression: "Sum(Sales)", label: "Sales", numberFormat: { type: "money" }, color: "#1f77b4" }],
      options: { stacked: true, showLegend: false, sortByMeasure: "desc" },
    }));
    assert.equal(body.sheetId, sheetId);
    assert.equal(body.validation.status, "pass", JSON.stringify(body.validation.findings));
    assert.deepEqual(body.placementFindings, []);
    assert.ok(body.notes.some((n) => /label ignored on a master dimension/.test(n)), JSON.stringify(body.notes));

    assert.ok(childrenOf(h, sheetId).includes(body.objectId), "object is a child of the sheet");
    const cell = cellsOf(h, sheetId).find((c) => c.name === body.objectId);
    assert.deepEqual({ ...cell }, { ...body.cell });
    const props = h.doc.objects.get(body.objectId).props;
    assert.equal(props.visualization, "barchart");
    assert.equal(props.title, "Revenue by region");
    assert.equal(props.qHyperCubeDef.qDimensions[0].qLibraryId, ids.dimensionId);
    assert.equal(props.qHyperCubeDef.qMeasures[0].qLibraryId, ids.measureId);
    assert.equal(props.qHyperCubeDef.qMeasures[1].qDef.qNumFormat.qType, "M");
    assert.equal(props.legend.show, false);
    assert.equal(props.barGrouping.grouping, "stacked");
  });

  test("every supported visualization type builds something its own gate accepts", async () => {
    const shapes = {
      kpi: [[], ["Sum(Sales)"]],
      gauge: [[], ["Sum(Sales)"]],
      barchart: [["Region"], ["Sum(Sales)"]],
      linechart: [["OrderDate"], ["Sum(Sales)"]],
      combochart: [["Region"], ["Sum(Sales)", "Avg(Sales)"]],
      piechart: [["Region"], ["Sum(Sales)"]],
      scatterplot: [["Product"], ["Sum(Sales)", "Count(Sales)"]],
      treemap: [["Region", "Product"], ["Sum(Sales)"]],
      table: [["Region", "Product"], ["Sum(Sales)"]],
      "pivot-table": [["Region", "Product"], ["Sum(Sales)"]],
      listbox: [["Region"], []],
      "text-image": [[], []],
      filterpane: [["Region", { expression: "=Year(OrderDate)", label: "Year" }], []],
    };
    const sheet = await newSheet(h, "All types");
    for (const [visualization, [dimensions, measures]] of Object.entries(shapes)) {
      const body = ok(await h.callApp("add_sheet_object", { sheetId: sheet, visualization, title: visualization, dimensions, measures }));
      assert.notEqual(body.validation.status, "fail", `${visualization}: ${JSON.stringify(body.validation.findings)}`);
      assert.ok(!body.placementFindings.some((f) => f.severity === "fail"), `${visualization}: ${JSON.stringify(body.placementFindings)}`);
      assert.equal(h.doc.objects.get(body.objectId).props.visualization, visualization);
    }
    // Auto-placement grew the grid instead of placing tiles off-sheet.
    const gate = ok(await h.callApp("validate_sheet", { sheetId: sheet }));
    assert.equal(gate.objectCount, Object.keys(shapes).length);
    assert.ok(!gate.placementFindings.some((f) => f.severity === "fail"), JSON.stringify(gate.placementFindings));
    assert.ok(gridOf(h, sheet).rows > 12, "grid grew to fit");
    assert.notEqual(gate.verdict, "FAIL");
  });

  test("a filterpane gets one listbox child per dimension", async () => {
    const body = ok(await h.callApp("add_sheet_object", { sheetId, visualization: "filterpane", dimensions: ["Region", "Product", { libraryId: ids.dimensionId }] }));
    const kids = h.doc.objects.get(body.objectId).children;
    assert.equal(kids.length, 3);
    for (const k of kids) assert.ok(h.doc.objects.get(k).props.qListObjectDef, "child is a listbox");
    assert.equal(body.validation.status, "warn"); // not render-verified yet, but not failing
  });

  test("auto-placement never overlaps an earlier, taller tile", async () => {
    // A piechart auto-places as 8x6; the 4th tile lands in the same column
    // one 4-row band lower and must not overlap it.
    const sheet = await newSheet(h, "Auto-place");
    ok(await h.callApp("add_sheet_object", { sheetId: sheet, visualization: "piechart", dimensions: ["Region"], measures: ["Sum(Sales)"] }));
    for (let i = 0; i < 3; i++) ok(await h.callApp("add_sheet_object", { sheetId: sheet, visualization: "kpi", measures: ["Sum(Sales)"] }));
    const gate = ok(await h.callApp("validate_sheet", { sheetId: sheet }));
    assert.deepEqual(gate.placementFindings, [], "auto-placed tiles overlap");
  });

  test("explicit position is honoured and the grid grows to fit it", async () => {
    const sheet = await newSheet(h, "Positioned");
    const body = ok(await h.callApp("add_sheet_object", { sheetId: sheet, visualization: "kpi", measures: ["Sum(Sales)"], position: { col: 20, row: 14, colspan: 8, rowspan: 4 } }));
    assert.deepEqual({ col: body.cell.col, row: body.cell.row, colspan: body.cell.colspan, rowspan: body.cell.rowspan }, { col: 20, row: 14, colspan: 8, rowspan: 4 });
    assert.deepEqual(gridOf(h, sheet), { columns: 28, rows: 18 });
    assert.deepEqual(body.placementFindings, []);
  });

  test("an unknown field in an inline measure is created but fails the gate (renders 0)", async () => {
    const body = ok(await h.callApp("add_sheet_object", { sheetId, visualization: "kpi", measures: ["Sum(Salse)"] }));
    assert.equal(body.validation.status, "fail");
    assert.ok(body.validation.findings.some((f) => /Salse/.test(f.message)));
    assert.ok(childrenOf(h, sheetId).includes(body.objectId));
  });

  test("an unknown visualization type is created but fails the gate", async () => {
    const body = ok(await h.callApp("add_sheet_object", { sheetId, visualization: "made-up-chart", dimensions: ["Region"], measures: ["Sum(Sales)"] }));
    assert.equal(body.validation.status, "fail");
    assert.ok(body.validation.findings.some((f) => /neither a built-in nor an installed extension/.test(f.message)));
  });

  test("options that do not apply are reported in notes, not silently dropped", async () => {
    const body = ok(await h.callApp("add_sheet_object", { sheetId, visualization: "kpi", measures: ["Sum(Sales)"], options: { showLegend: true, stacked: true } }));
    assert.ok(body.notes.some((n) => /showLegend does not apply to kpi/.test(n)), JSON.stringify(body.notes));
    assert.ok(body.notes.some((n) => /stacked does not apply to kpi/.test(n)), JSON.stringify(body.notes));
  });

  test("pre-flight refusals create nothing", async () => {
    const cases = [
      [{ visualization: "barchart", dimensions: ["Regoin"], measures: ["Sum(Sales)"] }, "NOT_FOUND", ["refusing to create", "Regoin"], { missingFields: ["Regoin"] }],
      [{ visualization: "barchart", dimensions: [{ expression: "Year(Salse)" }], measures: ["Sum(Sales)"] }, "VALIDATION_REFUSED", ["refusing to create", "Salse"], { dimension: 0, expression: "=Year(Salse)" }],
      [{ visualization: "kpi", measures: ["Sum((Sales)"] }, "VALIDATION_REFUSED", ["refusing to create", "expression error"], { measure: 0 }],
      [{ visualization: "kpi", measures: [{ libraryId: "measure-404" }] }, "NOT_FOUND", ["refusing to create", "measure-404"], { masterMeasureIds: ["measure-404"] }],
      [{ visualization: "barchart", dimensions: [{ libraryId: "dimension-404" }], measures: ["Sum(Sales)"] }, "NOT_FOUND", ["refusing to create", "dimension-404"], { masterDimensionIds: ["dimension-404"] }],
      [{ visualization: "kpi", measures: [{ expression: "Sum(Sales)", libraryId: ids.measureId }] }, "INVALID_INPUT", ["refusing to create", "exactly one"]],
      [{ visualization: "barchart", dimensions: [{ field: "=Year(OrderDate)" }], measures: ["Sum(Sales)"] }, "INVALID_INPUT", ["refusing to create", "expression"]],
      [{ visualization: "piechart", dimensions: ["Region", "Product"], measures: ["Sum(Sales)"] }, "VALIDATION_REFUSED", ["refusing to create", "piechart needs"], { visualization: "piechart" }],
      [{ visualization: "kpi", measures: [] }, "VALIDATION_REFUSED", ["refusing to create", "kpi needs"]],
      [{ visualization: "text-image", measures: ["Sum(Sales)"] }, "VALIDATION_REFUSED", ["refusing to create", "text-image needs"]],
      [{ visualization: "barchart", dimensions: ["Region"], measures: ["Sum(Sales)"], options: { colorMode: "single" } }, "INVALID_INPUT", ["refusing to create", "color"]],
      [{ visualization: "kpi", measures: ["="] }, "INVALID_INPUT", ["refusing to create", "empty"]],
    ];
    for (const [args, code, messageIncludes, details] of cases) {
      await refusedWithoutSideEffects(h, "add_sheet_object", { sheetId, ...args }, { code, messageIncludes, details });
    }
  });

  test("schema rejects malformed specs before the handler runs", async () => {
    expectInvalidArgs(await h.callApp("add_sheet_object", { sheetId, visualization: "kpi", measures: [{ expresion: "Sum(Sales)" }] }), "measures");
    expectInvalidArgs(await h.callApp("add_sheet_object", { sheetId, visualization: "barchart", dimensions: ["Region"], measures: ["Sum(Sales)"], options: { color: "red" } }), "options");
    expectInvalidArgs(await h.callApp("add_sheet_object", { sheetId, visualization: "kpi", measures: ["Sum(Sales)"], position: { col: -1, row: 0, colspan: 1, rowspan: 1 } }), "position");
  });

  test("an unknown sheet is a tool error", async () => {
    expectToolError(await h.callApp("add_sheet_object", { sheetId: "no-such-sheet", visualization: "kpi", measures: ["Sum(Sales)"] }), { code: "ENGINE_ERROR", messageIncludes: "no-such-sheet" });
  });
});

describe("builder: update_sheet_object", () => {
  let h, sheetId, ids;
  before(async () => {
    h = await startServer({ groups: ["developer"] });
    ids = await seedApp(h.doc);
    sheetId = await newSheet(h, "Edit");
  });
  after(() => h.close());

  const add = async (args) => ok(await h.callApp("add_sheet_object", { sheetId, ...args }));

  test("title-only update keeps id, type, dimensions, measures, formats and master links", async () => {
    const bar = await add({
      visualization: "barchart", title: "Before",
      dimensions: [{ field: "Region", label: "Area", sort: "desc" }],
      measures: [{ libraryId: ids.measureId }, { expression: "Sum(Sales)", label: "S", numberFormat: { type: "percent" } }],
    });
    const before = h.doc.objects.get(bar.objectId).props;
    const body = ok(await h.callApp("update_sheet_object", { objectId: bar.objectId, title: "After" }));
    assert.equal(body.objectId, bar.objectId);
    assert.equal(body.visualization, "barchart");
    assert.equal(body.validation.status, "pass", JSON.stringify(body.validation.findings));
    const after = h.doc.objects.get(bar.objectId).props;
    assert.equal(after.title, "After");
    assert.equal(after.qInfo.qId, bar.objectId);
    assert.deepEqual(after.qHyperCubeDef.qDimensions, before.qHyperCubeDef.qDimensions);
    assert.deepEqual(after.qHyperCubeDef.qMeasures.map((m) => m.qLibraryId ?? m.qDef.qDef), [ids.measureId, before.qHyperCubeDef.qMeasures[1].qDef.qDef]);
    assert.deepEqual(after.qHyperCubeDef.qMeasures[1].qDef.qNumFormat, before.qHyperCubeDef.qMeasures[1].qDef.qNumFormat);
  });

  test("replacing measures and options; omitted title is kept", async () => {
    const bar = await add({ visualization: "barchart", title: "Keep me", dimensions: ["Region"], measures: ["Sum(Sales)"], options: { showLegend: false } });
    const body = ok(await h.callApp("update_sheet_object", { objectId: bar.objectId, measures: ["Avg(Sales)", "Count(Sales)"], options: { colorMode: "byDimension" } }));
    assert.equal(body.validation.status, "pass", JSON.stringify(body.validation.findings));
    const props = h.doc.objects.get(bar.objectId).props;
    assert.equal(props.title, "Keep me");
    assert.deepEqual(props.qHyperCubeDef.qMeasures.map((m) => m.qDef.qDef), ["=Avg(Sales)", "=Count(Sales)"]);
    assert.equal(props.color.mode, "byDimension");
    // Options are not merged: the legend reverts to the default.
    assert.notEqual(props.legend.show, false);
  });

  test("a title EXPRESSION survives an update that does not pass a title", async () => {
    const kpi = await add({ visualization: "kpi", measures: ["Sum(Sales)"] });
    const obj = await h.doc.api.getObject(kpi.objectId);
    const p = await obj.getProperties();
    p.title = { qStringExpression: { qExpr: "='Total'" } };
    await obj.setProperties(p);
    ok(await h.callApp("update_sheet_object", { objectId: kpi.objectId, measures: ["Count(Sales)"] }));
    assert.deepEqual(h.doc.objects.get(kpi.objectId).props.title, { qStringExpression: { qExpr: "='Total'" } });
  });

  test("a filterpane's listbox children are rebuilt from the new dimensions", async () => {
    const pane = await add({ visualization: "filterpane", dimensions: ["Region", "Product"] });
    const oldKids = [...h.doc.objects.get(pane.objectId).children];
    ok(await h.callApp("update_sheet_object", { objectId: pane.objectId, dimensions: ["FiscalYear"] }));
    const kids = h.doc.objects.get(pane.objectId).children;
    assert.equal(kids.length, 1);
    assert.deepEqual(h.doc.objects.get(kids[0]).props.qListObjectDef.qDef.qFieldDefs, ["FiscalYear"]);
    for (const k of oldKids) assert.ok(!h.doc.objects.has(k), "old listbox destroyed");
  });

  test("a filterpane title-only update carries its listboxes over", async () => {
    const pane = await add({ visualization: "filterpane", dimensions: ["Region", "Product"] });
    ok(await h.callApp("update_sheet_object", { objectId: pane.objectId, title: "Filters" }));
    const kids = h.doc.objects.get(pane.objectId).children;
    assert.deepEqual(kids.map((k) => h.doc.objects.get(k).props.qListObjectDef.qDef.qFieldDefs[0]), ["Region", "Product"]);
  });

  test("refusals: nothing to update, non-builder type, pre-flight errors, unknown object", async () => {
    const kpi = await add({ visualization: "kpi", measures: ["Sum(Sales)"] });
    await refusedWithoutSideEffects(h, "update_sheet_object", { objectId: kpi.objectId }, { code: "INVALID_INPUT", messageIncludes: ["nothing to update"] });
    await refusedWithoutSideEffects(h, "update_sheet_object", { objectId: ids.extId, title: "x" }, { code: "VALIDATION_REFUSED", messageIncludes: ["refusing to update", "fake-extension-viz"] });
    await refusedWithoutSideEffects(h, "update_sheet_object", { objectId: sheetId, title: "x" }, { code: "VALIDATION_REFUSED", messageIncludes: ["refusing to update", "sheet"] });
    await refusedWithoutSideEffects(h, "update_sheet_object", { objectId: kpi.objectId, measures: ["Sum((Sales)"] }, { code: "VALIDATION_REFUSED", messageIncludes: ["refusing to update", "expression error"] });
    await refusedWithoutSideEffects(h, "update_sheet_object", { objectId: kpi.objectId, dimensions: ["Region"] }, { code: "VALIDATION_REFUSED", messageIncludes: ["refusing to update", "kpi needs"] });
    await refusedWithoutSideEffects(h, "update_sheet_object", { objectId: "ghost", title: "x" }, { code: "ENGINE_ERROR", messageIncludes: "ghost" });
  });
});

describe("builder: move_sheet_object and delete_sheet_object", () => {
  let h, sheetId, otherSheet;
  before(async () => {
    h = await startServer({ groups: ["developer"] });
    sheetId = await newSheet(h, "Layout");
    otherSheet = await newSheet(h, "Other");
  });
  after(() => h.close());

  const add = async (args) => ok(await h.callApp("add_sheet_object", { sheetId, ...args }));

  test("move replaces the object's cell, grows the grid and lints placement", async () => {
    const kpi = await add({ visualization: "kpi", measures: ["Sum(Sales)"] });
    const body = ok(await h.callApp("move_sheet_object", { sheetId, objectId: kpi.objectId, position: { col: 20, row: 10, colspan: 6, rowspan: 4 } }));
    assert.equal(body.objectId, kpi.objectId);
    assert.deepEqual(body.previous, { name: kpi.objectId, col: kpi.cell.col, row: kpi.cell.row, colspan: kpi.cell.colspan, rowspan: kpi.cell.rowspan });
    assert.deepEqual(body.grid, { columns: 26, rows: 14 });
    assert.deepEqual(body.placementFindings, []);
    const cells = cellsOf(h, sheetId).filter((c) => c.name === kpi.objectId);
    assert.equal(cells.length, 1, "exactly one cell per object");
    assert.deepEqual([cells[0].col, cells[0].row, cells[0].colspan, cells[0].rowspan], [20, 10, 6, 4]);
    assert.ok(h.doc.saves > 0);
  });

  test("move places an object that has no cell yet", async () => {
    const kpi = await add({ visualization: "kpi", measures: ["Sum(Sales)"] });
    const sheet = h.doc.objects.get(sheetId);
    sheet.props.cells = sheet.props.cells.filter((c) => c.name !== kpi.objectId);
    const body = ok(await h.callApp("move_sheet_object", { sheetId, objectId: kpi.objectId, position: { col: 0, row: 0, colspan: 2, rowspan: 2 } }));
    assert.equal(body.previous, null);
    assert.equal(cellsOf(h, sheetId).filter((c) => c.name === kpi.objectId).length, 1);
  });

  test("move refuses an object that is not a child of the sheet", async () => {
    const elsewhere = ok(await h.callApp("add_sheet_object", { sheetId: otherSheet, visualization: "kpi", measures: ["Sum(Sales)"] }));
    await refusedWithoutSideEffects(h, "move_sheet_object", { sheetId, objectId: elsewhere.objectId, position: { col: 0, row: 0, colspan: 1, rowspan: 1 } }, { code: "NOT_FOUND", messageIncludes: "not a child", details: { objectId: elsewhere.objectId, sheetId } });
    expectInvalidArgs(await h.callApp("move_sheet_object", { sheetId, objectId: elsewhere.objectId, position: { col: 0, row: 0, colspan: 0, rowspan: 1 } }), "colspan");
  });

  test("delete removes the object, its children and its cell", async () => {
    const pane = await add({ visualization: "filterpane", dimensions: ["Region", "Product"] });
    const kids = [...h.doc.objects.get(pane.objectId).children];
    const before = childrenOf(h, sheetId).length;
    const body = ok(await h.callApp("delete_sheet_object", { sheetId, objectId: pane.objectId }));
    assert.equal(body.deleted, pane.objectId);
    assert.equal(body.remainingObjects, before - 1);
    assert.ok(!h.doc.objects.has(pane.objectId));
    for (const k of kids) assert.ok(!h.doc.objects.has(k), "listbox child destroyed");
    assert.ok(!cellsOf(h, sheetId).some((c) => c.name === pane.objectId), "cell removed");
    assert.ok(!body.placementFindings.some((f) => f.message.includes(pane.objectId)));
  });

  test("delete refuses a non-child and a second delete of the same object", async () => {
    const kpi = await add({ visualization: "kpi", measures: ["Sum(Sales)"] });
    ok(await h.callApp("delete_sheet_object", { sheetId, objectId: kpi.objectId }));
    await refusedWithoutSideEffects(h, "delete_sheet_object", { sheetId, objectId: kpi.objectId }, { code: "NOT_FOUND", messageIncludes: "not a child" });
    const elsewhere = ok(await h.callApp("add_sheet_object", { sheetId: otherSheet, visualization: "kpi", measures: ["Sum(Sales)"] }));
    await refusedWithoutSideEffects(h, "delete_sheet_object", { sheetId, objectId: elsewhere.objectId }, { code: "NOT_FOUND", messageIncludes: "not a child" });
    assert.ok(h.doc.objects.has(elsewhere.objectId));
  });
});
