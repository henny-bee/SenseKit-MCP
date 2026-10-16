import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLineage } from "../../dist/core/lineage.js";

// ── classifyLineage ──────────────────────────────────────────────────────────

test("classifyLineage covers the discriminator taxonomy", () => {
  assert.equal(classifyLineage("INLINE;", "LOAD * INLINE"), "inline");
  assert.equal(classifyLineage("RESIDENT Revenue", "LOAD"), "resident");
  assert.equal(classifyLineage("C:\\qlik\\revenue_close.qvd", "LOAD"), "qvd");
  assert.equal(classifyLineage("lib://X/y.qvd", "STORE Revenue INTO"), "store");
  assert.equal(classifyLineage("Provider=SQLOLEDB;Data Source=w", "SQL SELECT"), "database");
  assert.equal(classifyLineage("something.xlsx", "LOAD"), "other");
});
