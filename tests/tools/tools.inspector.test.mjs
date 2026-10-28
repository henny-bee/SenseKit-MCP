import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, ok, expectToolError, expectInvalidArgs, deepIncludes } from "../helpers/harness.mjs";
import { seedApp, EXT_SECRET } from "../helpers/seed.mjs";

let h, ids;
before(async () => {
  h = await startServer({ groups: ["analyst"], allowMutations: false });
  ids = await seedApp(h.doc);
});
after(() => h.close());

describe("inspector: sheets and objects", () => {
  test("list_sheets lists sheets with id, title and published state", async () => {
    assert.deepEqual(ok(await h.callApp("list_sheets")), [{ sheetId: ids.sheetId, title: "Overview", published: false }]);
  });

  test("get_sheet_objects lists children with visualization and title (title expressions resolved to their text)", async () => {
    const body = ok(await h.callApp("get_sheet_objects", { sheetId: ids.sheetId }));
    assert.equal(body.sheetId, ids.sheetId);
    const byId = Object.fromEntries(body.objects.map((o) => [o.objectId, o]));
    assert.deepEqual(Object.keys(byId).sort(), [ids.barId, ids.kpiId, ids.extId].sort());
    assert.equal(byId[ids.barId].visualization, "barchart");
    assert.equal(byId[ids.barId].title, "Sales by region");
    assert.equal(byId[ids.barId].qType, "barchart");
    assert.match(byId[ids.kpiId].title, /Total/);
  });

  test("get_sheet_objects on an unknown sheet is a tool error", async () => {
    expectToolError(await h.callApp("get_sheet_objects", { sheetId: "nope" }), { code: "ENGINE_ERROR", messageIncludes: "nope" });
  });

  test("get_object_properties returns the property tree with secrets redacted", async () => {
    const body = ok(await h.callApp("get_object_properties", { objectId: ids.extId }));
    assert.equal(body.visualization, "fake-extension-viz");
    assert.equal(body.config.label, "Sales total");
    assert.ok(!deepIncludes(body, EXT_SECRET), "extension config secret leaked");
    assert.match(body.config.connection, /PWD=\*\*\*REDACTED\*\*\*/);
  });

  test("get_object_properties on an unknown object is a tool error", async () => {
    expectToolError(await h.callApp("get_object_properties", { objectId: "missing-obj" }), { code: "ENGINE_ERROR", messageIncludes: "missing-obj" });
  });
});

describe("inspector: search_expressions", () => {
  test("finds a term across objects (with owning sheet), master items, variables and script", async () => {
    const body = ok(await h.callApp("search_expressions", { term: "Sales", maxMatches: 200 }));
    assert.equal(body.term, "Sales");
    assert.equal(body.truncated, false);
    assert.ok(body.objectsScanned >= 4);
    assert.equal(body.matchCount, body.matches.length);
    const kinds = new Set(body.matches.map((m) => m.kind));
    for (const k of ["object", "master_measure", "variable", "script"]) assert.ok(kinds.has(k), `missing ${k} match`);
    const kpiHit = body.matches.find((m) => m.kind === "object" && m.objectId === ids.kpiId);
    assert.equal(kpiHit.sheetId, ids.sheetId);
    assert.equal(kpiHit.sheetTitle, "Overview");
    assert.match(kpiHit.path, /qHyperCubeDef/);
    const scriptHit = body.matches.find((m) => m.kind === "script");
    assert.equal(typeof scriptHit.line, "number");
    assert.equal(body.matches.find((m) => m.kind === "master_measure").title, "Revenue");
  });

  test("snippets never carry credentials (variables, script, object config)", async () => {
    for (const term of ["hunter", "vPassword", "Server=db"]) {
      const body = ok(await h.callApp("search_expressions", { term }));
      assert.ok(body.matchCount > 0, `expected a hit for ${term}`);
      assert.ok(!deepIncludes(body, "hunter2"), `script/variable secret leaked for ${term}`);
      assert.ok(!deepIncludes(body, EXT_SECRET), `object secret leaked for ${term}`);
    }
  });

  test("maxMatches caps results and reports truncation", async () => {
    const body = ok(await h.callApp("search_expressions", { term: "Sales", maxMatches: 1 }));
    assert.equal(body.matchCount, 1);
    assert.equal(body.truncated, true);
  });

  test("caseSensitive narrows matches", async () => {
    const ci = ok(await h.callApp("search_expressions", { term: "sales", maxMatches: 500 }));
    const cs = ok(await h.callApp("search_expressions", { term: "sales", caseSensitive: true, maxMatches: 500 }));
    assert.ok(cs.matchCount < ci.matchCount);
    for (const m of cs.matches) assert.ok(m.snippet.includes("sales"), m.snippet);
  });

  test("terms shorter than 2 characters are rejected", async () => {
    expectInvalidArgs(await h.callApp("search_expressions", { term: "S" }), "term");
  });
});

describe("inspector: master items and lineage", () => {
  test("list_master_measures returns id, title, label, expression, tags", async () => {
    const body = ok(await h.callApp("list_master_measures"));
    assert.equal(body.total, 1);
    assert.deepEqual(body.items[0], { measureId: ids.measureId, title: "Revenue", label: "Revenue", expression: "Sum(Sales)", tags: ["finance"] });
  });

  test("list_master_dimensions returns id, title, label and field defs", async () => {
    const body = ok(await h.callApp("list_master_dimensions"));
    assert.equal(body.total, 1);
    const d = body.items[0];
    assert.equal(d.dimensionId, ids.dimensionId);
    assert.equal(d.title, "Geo");
    assert.equal(d.label, "Geography");
    assert.deepEqual(d.fieldDefs, ["Region"]);
  });

  test("evaluate_master_measure by title and by id", async () => {
    const byTitle = ok(await h.callApp("evaluate_master_measure", { title: "Revenue" }));
    assert.equal(byTitle.measureId, ids.measureId);
    assert.equal(byTitle.expression, "Sum(Sales)");
    assert.equal(Number(byTitle.value), 100);
    assert.equal(byTitle.isNumeric, true);
    assert.deepEqual(byTitle.activeSelections, []);
    const byId = ok(await h.callApp("evaluate_master_measure", { measureId: ids.measureId }));
    assert.equal(Number(byId.value), 100);
    assert.equal(byId.title, "Revenue");
  });

  test("evaluate_master_measure refusals: no selector, unknown title, unknown id", async () => {
    expectToolError(await h.callApp("evaluate_master_measure", {}), { code: "INVALID_INPUT", messageIncludes: ["measureId", "title"] });
    expectToolError(await h.callApp("evaluate_master_measure", { title: "Nope" }), { code: "NOT_FOUND", details: { title: "Nope" }, messageIncludes: "Nope" });
    expectToolError(await h.callApp("evaluate_master_measure", { measureId: "measure-404" }), { code: "ENGINE_ERROR", messageIncludes: "measure-404" });
  });

  test("engine rejections are ENGINE_ERROR with the engine code; unexpected failures are INTERNAL", async () => {
    const engineFail = await startServer({ groups: ["analyst"], engineOptions: { docOverrides: {
      getLineage: async () => { throw Object.assign(new Error("Access denied"), { code: 5 }); },
    } } });
    const bug = await startServer({ groups: ["analyst"], engineOptions: { docOverrides: { getLineage: async () => null } } });
    try {
      expectToolError(await engineFail.callApp("get_app_lineage"), { code: "ENGINE_ERROR", messageIncludes: "Access denied", details: { engineCode: 5 } });
      expectToolError(await bug.callApp("get_app_lineage"), { code: "INTERNAL" });
    } finally {
      await engineFail.close();
      await bug.close();
    }
  });

  test("get_app_lineage classifies every source and target", async () => {
    const body = ok(await h.callApp("get_app_lineage"));
    assert.deepEqual(body.map((l) => l.kind), ["qvd", "inline", "store"]);
    assert.equal(body[0].discriminator, "lib://Data/sales.qvd");
    assert.equal(body[2].statement, "STORE Sales INTO");
  });
});
