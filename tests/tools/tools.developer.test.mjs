// Developer group: load script read/check/write, reload, and the QRS app
// lifecycle (create, copy, delete, publish).

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, ok, expectToolError, expectInvalidArgs, APP_ID } from "../helpers/harness.mjs";
import { NEW_APP_ID, DEFAULT_SCRIPT } from "../helpers/fake-engine.mjs";
import { COPY_APP_ID, STREAM_OBRIEN } from "../helpers/fake-qrs.mjs";

const CLEAN_SCRIPT = "Sales:\r\nLOAD 1 AS x AUTOGENERATE 1;\r\n";

describe("developer: script (read-only tools)", () => {
  let h;
  before(async () => { h = await startServer({ groups: ["developer"], allowMutations: false }); });
  after(() => h.close());

  test("get_script redacts credentials and says so", async () => {
    const script = ok(await h.callApp("get_script"));
    assert.ok(!script.includes("hunter2"), "secret leaked");
    assert.match(script, /redacted/i);
    assert.match(script, /vPassword = \*\*\*REDACTED\*\*\*/);
    assert.match(script, /LOAD Region, Product/);
  });

  test("get_script returns a clean script verbatim", async () => {
    const h2 = await startServer({ groups: ["developer"], engineOptions: { script: CLEAN_SCRIPT } });
    try {
      assert.equal(ok(await h2.callApp("get_script")), CLEAN_SCRIPT);
    } finally {
      await h2.close();
    }
  });

  test("check_script: clean, and with syntax errors", async () => {
    assert.match(ok(await h.callApp("check_script")), /no syntax errors/i);
    const errors = [{ qErrLen: 4, qLineInTab: 3, qColInLine: 1, qTabIx: 0 }];
    const h2 = await startServer({ groups: ["developer"], engineOptions: { scriptErrors: errors } });
    try {
      assert.deepEqual(ok(await h2.callApp("check_script")), errors);
    } finally {
      await h2.close();
    }
  });

  test("a non-GUID appId never reaches the engine", async () => {
    expectInvalidArgs(await h.call("get_script", { appId: "../../etc" }), "appId");
  });
});

describe("developer: set_script and reload_app (mutations)", () => {
  let h;
  before(async () => { h = await startServer({ groups: ["developer"], allowMutations: true }); });
  after(() => h.close());

  test("set_script replaces the script and saves", async () => {
    const saves = h.doc.saves;
    assert.match(ok(await h.callApp("set_script", { script: CLEAN_SCRIPT })), new RegExp(`${CLEAN_SCRIPT.length} chars`));
    assert.equal(h.doc.script, CLEAN_SCRIPT);
    assert.ok(h.doc.saves > saves, "app saved");
  });

  test("set_script refuses a script containing the redaction marker and leaves the app untouched", async () => {
    const before = h.doc.script;
    const saves = h.doc.saves;
    expectToolError(await h.callApp("set_script", { script: "SET vPassword = ***REDACTED***;" }), { code: "VALIDATION_REFUSED", messageIncludes: "REDACTED" });
    assert.equal(h.doc.script, before);
    assert.equal(h.doc.saves, saves);
  });

  test("reload_app reloads, saves and returns a scrubbed progress tail", async () => {
    const saves = h.doc.saves;
    const body = ok(await h.callApp("reload_app"));
    assert.equal(body.appId, APP_ID);
    assert.equal(body.reloadSuccess, true);
    assert.equal(body.saved, true);
    assert.match(body.progressTail, /Connecting to/);
    assert.ok(!body.progressTail.includes("hunter2"), "progress log secret leaked");
    assert.deepEqual(h.doc.reloads.at(-1), { partial: false });
    assert.ok(h.doc.saves > saves);
  });

  test("reload_app partial: true is passed through", async () => {
    ok(await h.callApp("reload_app", { partial: true }));
    assert.deepEqual(h.doc.reloads.at(-1), { partial: true });
  });

  test("a failed reload is reported and NOT saved", async () => {
    const h2 = await startServer({ groups: ["developer"], engineOptions: { reloadResult: false } });
    try {
      const body = ok(await h2.callApp("reload_app"));
      assert.equal(body.reloadSuccess, false);
      assert.equal(body.saved, false);
      assert.equal(h2.doc.saves, 0);
    } finally {
      await h2.close();
    }
  });
});

describe("developer: app lifecycle (mutations)", () => {
  let h;
  before(async () => { h = await startServer({ groups: ["developer"], allowMutations: true }); });
  after(() => h.close());

  test("create_app without a script creates an empty app", async () => {
    const body = ok(await h.call("create_app", { name: "Empty" }));
    assert.deepEqual(body, { appId: NEW_APP_ID, name: "Empty", scriptSet: false });
    assert.ok(h.fake.docs.has(NEW_APP_ID));
  });

  test("create_app with script + reload sets the script, reloads and saves the NEW app", async () => {
    const body = ok(await h.call("create_app", { name: "Built", script: CLEAN_SCRIPT, reload: true }));
    assert.equal(body.appId, NEW_APP_ID);
    assert.equal(body.scriptSet, true);
    assert.equal(body.reloaded, true);
    const created = h.fake.docs.get(NEW_APP_ID);
    assert.equal(created.script, CLEAN_SCRIPT);
    assert.equal(created.reloads.length, 1);
    assert.ok(created.saves > 0);
    assert.equal(h.doc.script, DEFAULT_SCRIPT, "source app untouched");
  });

  test("create_app reports an engine refusal", async () => {
    const h2 = await startServer({ groups: ["developer"], engineOptions: { globalOverrides: { createApp: async () => ({ qSuccess: false }) } } });
    try {
      expectToolError(await h2.call("create_app", { name: "x" }), { code: "ENGINE_ERROR", messageIncludes: "refused" });
    } finally {
      await h2.close();
    }
  });

  test("copy_app copies through QRS under the new name", async () => {
    const body = ok(await h.callApp("copy_app", { name: "Sales & Co (copy)" }));
    assert.deepEqual(body, { newAppId: COPY_APP_ID, name: "Sales & Co (copy)" });
    const post = h.qrs.calls.at(-1);
    assert.equal(post.method, "POST");
    assert.equal(post.path, `/qrs/app/${APP_ID}/copy?name=${encodeURIComponent("Sales & Co (copy)")}`);
  });

  test("delete_app deletes through QRS", async () => {
    assert.match(ok(await h.callApp("delete_app")), /deleted/);
    assert.deepEqual(h.qrs.calls.at(-1), { method: "DELETE", path: `/qrs/app/${APP_ID}`, body: undefined });
  });

  test("publish_app resolves the stream by (quoted) name and publishes to its id", async () => {
    const body = ok(await h.callApp("publish_app", { streamName: "O'Brien" }));
    assert.equal(body.published, true);
    assert.equal(body.stream, "O'Brien");
    assert.equal(body.appId, APP_ID);
    const put = h.qrs.calls.at(-1);
    assert.equal(put.method, "PUT");
    assert.equal(put.path, `/qrs/app/${APP_ID}/publish?stream=${STREAM_OBRIEN}`);
  });

  test("publish_app refuses an unknown stream without publishing", async () => {
    const before = h.qrs.calls.length;
    expectToolError(await h.callApp("publish_app", { streamName: "Nowhere" }), { code: "NOT_FOUND", details: { streamName: "Nowhere" }, messageIncludes: "Nowhere" });
    assert.ok(!h.qrs.calls.slice(before).some((c) => c.method === "PUT"), "no publish attempted");
  });
});
