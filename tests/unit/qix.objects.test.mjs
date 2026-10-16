import { test } from "node:test";
import assert from "node:assert/strict";
import { findLibraryRefs } from "../../dist/qix/objects.js";
import { fixture } from "./_helpers.mjs";

test("findLibraryRefs finds qLibraryId links, not look-alike strings", () => {
  assert.deepEqual(findLibraryRefs(fixture("kpi_library_ref.json"), "fixture-measure-1"), ["qHyperCubeDef.qMeasures[0].qLibraryId"]);
  assert.deepEqual(findLibraryRefs(fixture("kpi_library_ref.json"), "fixture-measure-2"), []);
  assert.deepEqual(findLibraryRefs({ title: "lib-x", qListObjectDef: { qLibraryId: "lib-x" } }, "lib-x"), ["qListObjectDef.qLibraryId"]);
});
