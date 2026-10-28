// A read-only server must not list mutating tools at all, not list-and-refuse.
import { describe, test, after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startServer, expectSdkError, APP_ID } from "../helpers/harness.mjs";
import { TOOLS, GROUPS, ERROR_CODES, expectedTools } from "../helpers/inventory.mjs";
import { ERROR_CODES as SRC_ERROR_CODES } from "../../dist/core/errors.js";

const GROUP_SETS = [
  ["analyst"], ["developer"], ["admin"],
  ["analyst", "developer"], ["analyst", "admin"], ["developer", "admin"],
  GROUPS,
];

describe("tool gating: groups × mutations × certificate", () => {
  for (const groups of GROUP_SETS) {
    for (const allowMutations of [true, false]) {
      for (const cert of [false, true]) {
        test(`groups=${groups.join("+")} mutations=${allowMutations} cert=${cert}`, async () => {
          const h = await startServer({ groups, allowMutations, cert });
          try {
            assert.deepEqual(await h.toolNames(), expectedTools({ groups, allowMutations, cert }));
          } finally {
            await h.close();
          }
        });
      }
    }
  }

  test("no groups configured -> no tools", async () => {
    const h = await startServer({ groups: [] });
    try {
      const names = await h.client.listTools().then((r) => r.tools.map((t) => t.name), () => []);
      assert.deepEqual(names, []);
    } finally {
      await h.close();
    }
  });

  test("an unknown group name registers nothing extra", async () => {
    const h = await startServer({ groups: ["analyst", "superuser"] });
    try {
      assert.deepEqual(await h.toolNames(), expectedTools({ groups: ["analyst"] }));
    } finally {
      await h.close();
    }
  });

  test("calling a mutating tool on a read-only server is an error, and nothing changes", async () => {
    const h = await startServer({ allowMutations: false });
    try {
      for (const [name, args] of [
        ["set_script", { appId: APP_ID, script: "LOAD 1 AS x AUTOGENERATE 1;" }],
        ["create_sheet", { appId: APP_ID, title: "S" }],
        ["delete_app", { appId: APP_ID }],
        ["start_task", { taskId: APP_ID }],
        ["create_master_measure", { appId: APP_ID, title: "T", expression: "Sum(Sales)" }],
      ]) {
        expectSdkError(await h.call(name, args), name);
      }
      assert.equal(h.doc.saves, 0);
      assert.equal(h.doc.objects.size, 0);
      assert.equal(h.doc.measures.size, 0);
      assert.ok(!h.qrs.calls.some((c) => c.method !== "GET"), "no QRS writes");
    } finally {
      await h.close();
    }
  });

  test("server reports the package version; unknown tools are an error result", async () => {
    const h = await startServer();
    try {
      const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
      assert.equal(h.client.getServerVersion().version, pkg.version);
      expectSdkError(await h.call("no_such_tool", {}), "no_such_tool");
    } finally {
      await h.close();
    }
  });

  test("the structured error code set matches the published contract", () => {
    assert.deepEqual([...SRC_ERROR_CODES].sort(), [...ERROR_CODES].sort());
  });

  test("the inventory covers every tool a fully-enabled server lists", async () => {
    const h = await startServer({ allowMutations: true, cert: true });
    try {
      assert.deepEqual(await h.toolNames(), Object.keys(TOOLS).sort());
    } finally {
      await h.close();
    }
  });
});

describe("tool annotations and metadata", () => {
  let h, tools;
  before(async () => {
    h = await startServer({ allowMutations: true, cert: true });
    tools = await h.tools();
  });
  after(() => h.close());

  test("every tool has a description and a closed-world annotation", () => {
    for (const t of tools) {
      assert.ok(t.description && t.description.length > 20, `${t.name}: description`);
      assert.equal(t.annotations?.openWorldHint, false, `${t.name}: openWorldHint`);
    }
  });

  test("read-only tools are flagged readOnlyHint: true", () => {
    for (const t of tools) {
      const spec = TOOLS[t.name];
      if (spec.mutating || spec.session) continue;
      assert.equal(t.annotations?.readOnlyHint, true, `${t.name}: readOnlyHint`);
    }
  });

  test("mutating tools are readOnlyHint: false with the expected destructiveHint", () => {
    for (const t of tools) {
      const spec = TOOLS[t.name];
      if (!spec.mutating) continue;
      assert.equal(t.annotations?.readOnlyHint, false, `${t.name}: readOnlyHint`);
      assert.equal(t.annotations?.destructiveHint, spec.destructive, `${t.name}: destructiveHint`);
    }
  });

  test("destructive tools say MUTATION in their description", () => {
    for (const t of tools) {
      if (!TOOLS[t.name].mutating) continue;
      assert.match(t.description, /MUTATION/, `${t.name}: description should warn`);
    }
  });

  test("selection tools change session state only: not read-only, not destructive, not mutation-gated", () => {
    for (const t of tools.filter((x) => TOOLS[x.name].session)) {
      assert.equal(t.annotations?.readOnlyHint, false, t.name);
      assert.equal(t.annotations?.destructiveHint, false, t.name);
    }
  });

  test("every appId / taskId parameter is validated as a GUID", () => {
    for (const t of tools) {
      for (const p of ["appId", "taskId"]) {
        const s = t.inputSchema?.properties?.[p];
        if (!s) continue;
        assert.ok(s.pattern, `${t.name}.${p} should carry a GUID pattern`);
        assert.ok(new RegExp(s.pattern).test(APP_ID), `${t.name}.${p} pattern accepts a GUID`);
        assert.ok(!new RegExp(s.pattern).test("../../qrs/app"), `${t.name}.${p} pattern rejects a path`);
      }
    }
  });

  test("paged list tools expose offset/limit", () => {
    const paged = ["list_apps", "list_streams", "list_tasks", "list_users", "list_extensions", "list_data_connections",
      "qrs_search", "security_rule_audit", "list_engine_apps", "list_master_measures", "list_master_dimensions"];
    for (const name of paged) {
      const t = tools.find((x) => x.name === name);
      assert.ok(t.inputSchema.properties.offset && t.inputSchema.properties.limit, `${name}: paging params`);
    }
  });
});
