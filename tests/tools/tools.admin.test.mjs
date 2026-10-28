import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, ok, expectToolError, expectInvalidArgs, deepIncludes } from "../helpers/harness.mjs";
import { createFakeQrs, qrsHttpError, TASK_OK, TASK_FAILED } from "../helpers/fake-qrs.mjs";

const SECRETS = ["SuperSecret123!", "AlsoVerySecret456", "SYNTHETIC~not~a~real~client~secret", "SYNTHETIC~saml~counterpart"];
const assertNoSecrets = (v) => {
  for (const s of SECRETS) assert.ok(!deepIncludes(v, s), `leaked secret ${s}`);
};

describe("admin: site information", () => {
  let h;
  before(async () => { h = await startServer({ groups: ["admin"] }); });
  after(() => h.close());

  test("qrs_about returns the repository about payload", async () => {
    const body = ok(await h.call("qrs_about"));
    assert.equal(body.buildVersion, "14.212.6");
  });

  test("service_status names services and states and flags health", async () => {
    const rows = ok(await h.call("service_status"));
    assert.equal(rows.length, 4);
    assert.deepEqual(rows[0], { node: "node1.example.invalid", service: "Repository", state: "Running", healthy: true });
    assert.deepEqual(rows[2], { node: "node2", service: "Scheduler", state: "NoCommunication", healthy: false });
    assert.equal(rows[3].service, "type-42");
    assert.equal(rows[3].state, "state-77");
  });

  test("license_summary combines license and access allocations", async () => {
    const body = ok(await h.call("license_summary"));
    assert.equal(body.serial, "9999000000001234");
    assert.equal(body.isExpired, false);
    assert.deepEqual(body.professionalAllocated, ["LAB\\alice", "LAB\\bob"]);
    assert.deepEqual(body.analyzerAllocated, ["LAB\\carol"]);
  });
});

describe("admin: listings and paging", () => {
  let h;
  before(async () => { h = await startServer({ groups: ["admin"] }); });
  after(() => h.close());

  test("list_apps returns the paging envelope with condensed apps", async () => {
    const body = ok(await h.call("list_apps"));
    assert.deepEqual(Object.keys(body).sort(), ["items", "offset", "returned", "total", "truncated"]);
    assert.equal(body.total, 3);
    assert.equal(body.truncated, false);
    assert.deepEqual(body.items[0], {
      id: "app-1", name: "Sales", owner: "LAB\\alice", stream: "Everyone", published: true,
      lastReloadTime: "2026-10-01T02:03:00Z", fileSizeBytes: 2048,
    });
    assert.equal(body.items[1].stream, null);
  });

  test("list_apps pages with offset/limit and reports truncation", async () => {
    const body = ok(await h.call("list_apps", { offset: 1, limit: 1 }));
    assert.equal(body.total, 3);
    assert.equal(body.offset, 1);
    assert.equal(body.returned, 1);
    assert.equal(body.truncated, true);
    assert.equal(body.items[0].name, "Finance");
  });

  test("list_apps forwards the QRS filter URL-encoded", async () => {
    ok(await h.call("list_apps", { filter: "name sw 'Sa&les'" }));
    const call = h.qrs.calls.at(-1);
    assert.equal(call.path, `/qrs/app/full?filter=${encodeURIComponent("name sw 'Sa&les'")}`);
  });

  test("paging parameters are validated", async () => {
    expectInvalidArgs(await h.call("list_apps", { limit: 0 }), "limit");
    expectInvalidArgs(await h.call("list_apps", { limit: 5000 }), "limit");
    expectInvalidArgs(await h.call("list_apps", { offset: -1 }), "offset");
  });

  test("list_streams, list_users, list_extensions return condensed rows", async () => {
    const streams = ok(await h.call("list_streams"));
    assert.deepEqual(streams.items.map((s) => s.name), ["Everyone", "O'Brien"]);
    assert.equal(streams.items[0].owner, "INTERNAL\\sa_repository");

    const users = ok(await h.call("list_users", { filter: "userId eq 'alice'" }));
    assert.equal(users.items[0].user, "LAB\\alice");
    assert.deepEqual(users.items[0].roles, ["RootAdmin"]);
    assert.equal(users.items[1].inactive, true);
    assert.ok(h.qrs.calls.at(-1).path.includes(`filter=${encodeURIComponent("userId eq 'alice'")}`));

    const ext = ok(await h.call("list_extensions"));
    assert.deepEqual(ext.items, [{ id: "ext-1", name: "fake-extension-viz", owner: "LAB\\alice" }]);
  });

  test("list_tasks maps execution status codes, unknown ones to 'Unknown'", async () => {
    const body = ok(await h.call("list_tasks"));
    const byName = Object.fromEntries(body.items.map((t) => [t.name, t]));
    assert.equal(byName["Nightly Sales"].lastStatus, "FinishedSuccess");
    assert.equal(byName["Nightly Sales"].app, "Sales");
    assert.equal(byName["Finance Reload"].lastStatus, "FinishedFail");
    assert.equal(byName["Never Run"].lastStatus, "Unknown");
    assert.equal(byName["Weird Status"].lastStatus, "Unknown");
  });

  test("QRS failures map to structured codes: 403 -> AUTH_ERROR, 5xx -> QRS_ERROR, with secrets redacted", async () => {
    const qrs = createFakeQrs({ routes: [
      ["GET", /^\/qrs\/stream\/full/, (_m, _b, _s, p) => { throw qrsHttpError(500, "GET", p, "Server=db;PWD=Leaky42;"); }],
    ] });
    const h2 = await startServer({ groups: ["admin"], qrs });
    try {
      const e = expectToolError(await h2.call("list_streams"), { code: "QRS_ERROR", messageIncludes: "500", details: { status: 500, method: "GET" } });
      assert.ok(!e.raw.includes("Leaky42"), `secret leaked through the error payload: ${e.raw}`);
    } finally {
      await h2.close();
    }
  });

  test("a QRS failure surfaces as a tool error carrying the HTTP status", async () => {
    const qrs = createFakeQrs({ routes: [["GET", /^\/qrs\/app\/full/, (_m, _b, _s, p) => { throw qrsHttpError(403, "GET", p, "Forbidden"); }]] });
    const h2 = await startServer({ groups: ["admin"], qrs });
    try {
      expectToolError(await h2.call("list_apps"), { code: "AUTH_ERROR", details: { status: 403 }, messageIncludes: "403" });
    } finally {
      await h2.close();
    }
  });
});

describe("admin: credential redaction on QRS output", () => {
  let h;
  before(async () => { h = await startServer({ groups: ["admin"] }); });
  after(() => h.close());

  test("list_data_connections masks password fields and connection-string secrets", async () => {
    const body = ok(await h.call("list_data_connections"));
    assertNoSecrets(body);
    const dc = body.items[0];
    assert.equal(dc.name, "WarehouseDB");
    assert.match(dc.connectionstring, /PWD=\*\*\*REDACTED\*\*\*/);
    assert.match(dc.connectionstring, /Data Source=warehouse\.internal/);
  });

  test("qrs_search redacts full data connections", async () => {
    const body = ok(await h.call("qrs_search", { entity: "dataconnection", full: true }));
    assertNoSecrets(body);
    assert.equal(body.items[0].password, "***REDACTED***");
    // "No credential" is not a secret: empty stays empty.
    assert.equal(body.items[0].passphrase, "");
    assert.equal(h.qrs.calls.at(-1).path, "/qrs/dataconnection/full");
  });

  test("qrs_search redacts camelCase identity-provider secrets (virtualproxyconfig)", async () => {
    const body = ok(await h.call("qrs_search", { entity: "virtualproxyconfig", full: true }));
    assertNoSecrets(body);
    assert.equal(body.items[0].oidcClientSecret, "***REDACTED***");
    assert.equal(body.items[0].samlClientSecret, "***REDACTED***");
    assert.equal(body.items[0].prefix, "oidc");
  });

  test("qrs_search pages arrays (smaller default page for full entities) and passes objects through", async () => {
    const qrs = createFakeQrs({
      routes: [["GET", /^\/qrs\/tag/, () => Array.from({ length: 150 }, (_, i) => ({ id: `t${i}`, name: `tag${i}` }))]],
    });
    const h2 = await startServer({ groups: ["admin"], qrs });
    try {
      const condensed = ok(await h2.call("qrs_search", { entity: "tag" }));
      assert.equal(condensed.total, 150);
      assert.equal(condensed.returned, 100);
      const full = ok(await h2.call("qrs_search", { entity: "tag", full: true, filter: "name sw 'tag1'" }));
      assert.equal(full.returned, 25);
      assert.equal(qrs.calls.at(-1).path, `/qrs/tag/full?filter=${encodeURIComponent("name sw 'tag1'")}`);
      const about = ok(await h2.call("qrs_search", { entity: "about" }));
      assert.equal(about.buildVersion, "14.212.6");
    } finally {
      await h2.close();
    }
  });
});

describe("admin: start_task (mutation)", () => {
  let h;
  before(async () => { h = await startServer({ groups: ["admin"], allowMutations: true }); });
  after(() => h.close());

  test("posts a start request for the task", async () => {
    const res = await h.call("start_task", { taskId: TASK_OK });
    const body = ok(res);
    assert.match(String(body), new RegExp(TASK_OK));
    assert.ok(h.qrs.calls.some((c) => c.method === "POST" && c.path === `/qrs/task/${TASK_OK}/start`));
  });

  test("refuses a non-GUID task id before touching QRS", async () => {
    const before = h.qrs.calls.length;
    expectInvalidArgs(await h.call("start_task", { taskId: "../app/x" }), "taskId");
    assert.equal(h.qrs.calls.length, before);
  });

  test("a QRS 404 is reported as a tool error", async () => {
    const qrs = createFakeQrs({ routes: [["POST", /^\/qrs\/task\//, (_m, _b, _s, p) => { throw qrsHttpError(404, "POST", p, "Not Found"); }]] });
    const h2 = await startServer({ groups: ["admin"], qrs });
    try {
      expectToolError(await h2.call("start_task", { taskId: TASK_FAILED }), { code: "NOT_FOUND", details: { status: 404, method: "POST" }, messageIncludes: "404" });
    } finally {
      await h2.close();
    }
  });
});
