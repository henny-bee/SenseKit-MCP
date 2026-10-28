import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, ok, expectToolError, expectInvalidArgs, deepIncludes } from "../helpers/harness.mjs";
import { ProxySession } from "../../dist/clients/proxy-session.js";
import { startLoopbackHttps, startDroppingServer, loopbackConfig } from "../helpers/loopback-https.mjs";
import { createFakeQrs, TASK_OK, TASK_FAILED, TASK_NEVER_RUN, TASK_NO_LOG } from "../helpers/fake-qrs.mjs";

describe("ops: get_reload_log", () => {
  let h;
  before(async () => { h = await startServer({ groups: ["admin"] }); });
  after(() => h.close());

  test("failed task: status, timing, scrubbed detail timeline and log tail", async () => {
    const body = ok(await h.call("get_reload_log", { taskId: TASK_FAILED, tailLines: 3 }));
    assert.equal(body.taskId, TASK_FAILED);
    assert.equal(body.taskName, "Finance Reload");
    assert.equal(body.appName, "Finance");
    assert.equal(body.status, "FinishedFail");
    assert.equal(body.durationMs, 9000);
    assert.equal(body.executingNode, "node1");
    assert.equal(body.details.length, 2);
    assert.match(body.details[1].message, /Connector error/);
    assert.deepEqual(body.log.lines.length, 3);
    assert.equal(body.log.totalLines, 12);
    assert.equal(body.log.droppedLeadingLines, 9);
    assert.match(body.log.lines[2], /line 12$/);
    assert.ok(!deepIncludes(body, "s3cret"), "reload log and details must be scrubbed");
    assert.match(body.log.lines[1], /PWD=\*\*\*REDACTED\*\*\*/);
  });

  test("default tail returns the whole short log", async () => {
    const body = ok(await h.call("get_reload_log", { taskId: TASK_OK }));
    assert.equal(body.status, "FinishedSuccess");
    assert.equal(body.log.lines.length, 12);
    assert.equal(body.log.droppedLeadingLines, 0);
  });

  test("a never-run task returns a null log with a note", async () => {
    const body = ok(await h.call("get_reload_log", { taskId: TASK_NEVER_RUN }));
    assert.equal(body.log, null);
    assert.match(body.note, /no execution result/i);
  });

  test("a nil file reference returns a null log; unknown status is named, not dropped", async () => {
    const body = ok(await h.call("get_reload_log", { taskId: TASK_NO_LOG }));
    assert.equal(body.log, null);
    assert.match(body.note, /no script log/i);
    assert.equal(body.status, "status-99");
  });

  test("log staging that returns no GUID is reported in a note, not thrown", async () => {
    const qrs = createFakeQrs({ routes: [["GET", /\/scriptlog\?fileReferenceId=/, () => ({})]] });
    const h2 = await startServer({ groups: ["admin"], qrs });
    try {
      const body = ok(await h2.call("get_reload_log", { taskId: TASK_FAILED }));
      assert.equal(body.log, null);
      assert.match(body.note, /no GUID/i);
      assert.equal(body.status, "FinishedFail");
    } finally {
      await h2.close();
    }
  });

  test("an unknown task is a tool error", async () => {
    expectToolError(await h.call("get_reload_log", { taskId: "eeeeeeee-0000-0000-0000-000000000000" }), { code: "NOT_FOUND", details: { status: 404 }, messageIncludes: "404" });
  });

  test("taskId and tailLines are validated", async () => {
    expectInvalidArgs(await h.call("get_reload_log", { taskId: "nightly" }), "taskId");
    expectInvalidArgs(await h.call("get_reload_log", { taskId: TASK_OK, tailLines: 0 }), "tailLines");
    expectInvalidArgs(await h.call("get_reload_log", { taskId: TASK_OK, tailLines: 2001 }), "tailLines");
  });
});

describe("ops: security_rule_audit", () => {
  let h;
  before(async () => { h = await startServer({ groups: ["admin"] }); });
  after(() => h.close());

  test("counts, decoded actions and lint findings", async () => {
    const body = ok(await h.call("security_rule_audit"));
    assert.equal(body.totalRules, 5);
    assert.equal(body.shippedRules, 2);
    assert.equal(body.customRules, 3);
    assert.equal(body.disabledRules, 2);
    const sev = (id) => body.findings.filter((f) => f.ruleId === id).map((f) => f.severity).sort();
    assert.deepEqual(sev("r1"), []);
    assert.deepEqual(sev("r2"), ["warn"]); // disabled default rule
    assert.deepEqual(sev("r3"), ["high"]); // resourceFilter '*'
    assert.deepEqual(sev("r4"), ["high"]); // unconditional write grant
    assert.deepEqual(sev("r5"), ["info"]); // dead custom rule
    const god = body.rules.items.find((r) => r.id === "r4");
    assert.deepEqual(god.actions, ["Update", "Delete"]);
    assert.equal(god.condition, "true");
    assert.equal(god.comment, "temporary");
    assert.ok(h.qrs.calls.at(-1).path.includes(encodeURIComponent("category eq 'Security'")));
  });

  test("includeRules: false returns counts and findings only", async () => {
    const body = ok(await h.call("security_rule_audit", { includeRules: false }));
    assert.equal(body.rules, undefined);
    assert.equal(body.totalRules, 5);
    assert.ok(body.findings.length >= 4);
  });

  test("rules are paged", async () => {
    const body = ok(await h.call("security_rule_audit", { limit: 2, offset: 1 }));
    assert.equal(body.rules.total, 5);
    assert.equal(body.rules.returned, 2);
    assert.equal(body.rules.truncated, true);
    assert.equal(body.rules.items[0].id, "r2");
  });
});

const HEALTH = {
  version: "12.1477.4", started: "20261001T020000.000+0000", saturated: false,
  mem: { committed: 2048, allocated: 1500, free: 512 }, cpu: { total: 12 },
  session: { active: 2, total: 5 },
  apps: { active_docs: ["a"], loaded_docs: ["a", "b"], in_memory_docs: ["a", "b", "c"], calls: 120, selections: 7 },
  users: { active: 1, total: 3 },
};
// Fake ProxySession; retry logic is tested in clients.proxy-session.test.mjs.
const CREDS = { cookie: "X-Qlik-Session=sess-1", csrfToken: "csrf-1" };
const fakeSession = { ensure: async () => CREDS, run: async (op) => op(CREDS), invalidate() {} };

describe("ops: engine_healthcheck (loopback HTTPS)", () => {
  let srv, reply;
  before(async () => { srv = await startLoopbackHttps(() => reply); });
  after(() => srv.close());

  test("certificate mode: calls the engine port with the service identity and summarizes", async () => {
    reply = { status: 200, body: HEALTH };
    const h = await startServer({ cfg: loopbackConfig(srv.port) });
    try {
      const body = ok(await h.call("engine_healthcheck"));
      assert.equal(body.version, "12.1477.4");
      assert.equal(body.saturated, false);
      assert.equal(body.memCommittedMB, 2048);
      assert.equal(body.memFreeMB, 512);
      assert.equal(body.cpuTotalPct, 12);
      assert.deepEqual([body.apps.activeDocs, body.apps.loadedDocs, body.apps.inMemoryDocs], [1, 2, 3]);
      assert.deepEqual(body.raw, HEALTH);
      const req = srv.requests.at(-1);
      assert.equal(req.method, "GET");
      assert.match(req.path, /^\/engine\/healthcheck\/\?xrfkey=([0-9a-f]{16})$/);
      assert.equal(req.headers["x-qlik-xrfkey"], /xrfkey=(\w+)/.exec(req.path)[1], "xrfkey header matches the query");
      assert.equal(req.headers["x-qlik-user"], "UserDirectory=INTERNAL; UserId=sa_repository");
    } finally {
      await h.close();
    }
  });

  test("jwt mode: goes through the virtual proxy with the session cookie, no service identity", async () => {
    reply = { status: 200, body: HEALTH };
    // cfg.ca alone (QSEOW_ROOT_CERT_PATH) must be trusted on the proxy leg too.
    const h = await startServer({ cfg: loopbackConfig(srv.port, { authMode: "jwt", rootCaOnly: true }), deps: { session: fakeSession } });
    try {
      ok(await h.call("engine_healthcheck"));
      const req = srv.requests.at(-1);
      assert.match(req.path, /^\/jwt\/engine\/healthcheck\/\?xrfkey=/);
      assert.equal(req.headers.cookie, "X-Qlik-Session=sess-1");
      assert.equal(req.headers["x-qlik-user"], undefined);
    } finally {
      await h.close();
    }
  });

  test("HTTP failures map to codes: 403 AUTH_ERROR, 500 ENGINE_ERROR, empty 200 ENGINE_ERROR", async () => {
    const h = await startServer({ cfg: loopbackConfig(srv.port) });
    try {
      reply = { status: 403, body: "Forbidden" };
      expectToolError(await h.call("engine_healthcheck"), { code: "AUTH_ERROR", messageIncludes: "403", details: { status: 403 } });
      reply = { status: 500, body: "boom" };
      expectToolError(await h.call("engine_healthcheck"), { code: "ENGINE_ERROR", messageIncludes: "500", details: { status: 500 } });
      reply = { status: 200 };
      expectToolError(await h.call("engine_healthcheck"), { code: "ENGINE_ERROR" });
    } finally {
      await h.close();
    }
  });
});

describe("ops: QPS session tools (loopback HTTPS)", () => {
  let srv, reply;
  before(async () => { srv = await startLoopbackHttps(() => reply); });
  after(() => srv.close());

  test("list_user_sessions: GET on the QPS user path, sessions condensed", async () => {
    reply = { status: 200, body: [{ SessionId: "s1", Attributes: [{ Group: "Sales" }] }, { SessionId: "s2", Attributes: [] }] };
    const h = await startServer({ cfg: loopbackConfig(srv.port, { allowMutations: false }) });
    try {
      const body = ok(await h.call("list_user_sessions", { directory: "LAB", userId: "alice" }));
      assert.deepEqual(body, {
        user: "LAB\\alice", virtualProxy: "(default)", sessionCount: 2,
        sessions: [{ sessionId: "s1", attributes: [{ Group: "Sales" }] }, { sessionId: "s2", attributes: [] }],
      });
      const req = srv.requests.at(-1);
      assert.equal(req.method, "GET");
      assert.match(req.path, /^\/qps\/user\/LAB\/alice\?xrfkey=/);
      assert.equal(req.headers["x-qlik-user"], "UserDirectory=INTERNAL; UserId=sa_repository");

      reply = { status: 200, body: "" };
      const vp = ok(await h.call("list_user_sessions", { directory: "LAB DOMAIN", userId: "o'brien/x", virtualProxy: "hub" }));
      assert.equal(vp.sessionCount, 0);
      assert.equal(vp.virtualProxy, "hub");
      assert.ok(srv.requests.at(-1).path.startsWith(`/qps/hub/user/${encodeURIComponent("LAB DOMAIN")}/${encodeURIComponent("o'brien/x")}?`),
        "directory and user id are URL-encoded into the path");
    } finally {
      await h.close();
    }
  });

  test("end_user_sessions: DELETE, counts ended sessions (null body = none)", async () => {
    const h = await startServer({ cfg: loopbackConfig(srv.port) });
    try {
      reply = { status: 200, body: [{ SessionId: "s1" }, { SessionId: "s2" }] };
      assert.deepEqual(ok(await h.call("end_user_sessions", { directory: "LAB", userId: "alice" })),
        { user: "LAB\\alice", virtualProxy: "(default)", endedSessions: 2 });
      assert.equal(srv.requests.at(-1).method, "DELETE");
      reply = { status: 200, body: "null" };
      assert.equal(ok(await h.call("end_user_sessions", { directory: "LAB", userId: "bob", virtualProxy: "hub" })).endedSessions, 0);
      assert.match(srv.requests.at(-1).path, /^\/qps\/hub\/user\/LAB\/bob\?/);
    } finally {
      await h.close();
    }
  });

  test("QPS HTTP failures map to codes: 401 AUTH_ERROR, 404 NOT_FOUND, 500 PROXY_ERROR", async () => {
    const h = await startServer({ cfg: loopbackConfig(srv.port) });
    try {
      reply = { status: 401, body: "no" };
      expectToolError(await h.call("list_user_sessions", { directory: "LAB", userId: "alice" }), { code: "AUTH_ERROR", details: { status: 401 } });
      reply = { status: 404, body: "no such proxy" };
      expectToolError(await h.call("list_user_sessions", { directory: "LAB", userId: "alice", virtualProxy: "nope" }), { code: "NOT_FOUND" });
      reply = { status: 500, body: "boom" };
      expectToolError(await h.call("end_user_sessions", { directory: "LAB", userId: "alice" }), { code: "PROXY_ERROR", messageIncludes: "500" });
    } finally {
      await h.close();
    }
  });
});

describe("ops: network failures on the HTTPS-direct tools", () => {
  test("a dropped connection is a structured error naming the port", async () => {
    const dead = await startDroppingServer();
    const h = await startServer({ cfg: loopbackConfig(dead.port) });
    try {
      expectToolError(await h.call("engine_healthcheck"), { code: "ENGINE_ERROR", details: { port: dead.port } });
      expectToolError(await h.call("list_user_sessions", { directory: "LAB", userId: "alice" }), { code: "PROXY_ERROR", details: { port: dead.port } });
    } finally {
      await h.close();
      await dead.close();
    }
  });
});

describe("ops: jwt mode end to end with the real ProxySession (loopback)", () => {
  // Proxy accepts only `valid` sessions (new ones while `acceptNew`), else `reject`.
  let srv, minted, valid, reject, acceptNew;
  before(async () => {
    srv = await startLoopbackHttps((req) => {
      if (req.path.startsWith("/jwt/qps/csrftoken")) {
        if (req.headers.authorization !== "Bearer header.payload.signature") return { status: 401 };
        const n = ++minted;
        if (acceptNew) valid.add(`X-Qlik-Session-jwt=sess-${n}`);
        return { status: 204, headers: { "qlik-csrf-token": `csrf-${n}`, "set-cookie": `X-Qlik-Session-jwt=sess-${n}; Path=/; HttpOnly; Secure` } };
      }
      if (req.path.startsWith("/jwt/engine/healthcheck/")) {
        return valid.has(req.headers.cookie) ? { status: 200, body: HEALTH } : { status: reject, body: "session rejected" };
      }
      return { status: 404 };
    });
  });
  after(() => srv.close());

  async function jwtServer() {
    minted = 0; valid = new Set(); reject = 401; acceptNew = true;
    const cfg = loopbackConfig(srv.port, { authMode: "jwt", rootCaOnly: true });
    const session = new ProxySession(cfg);
    const h = await startServer({ cfg, deps: { session } });
    return { h, session };
  }

  test("bootstraps once and reuses the session across calls", async () => {
    const { h, session } = await jwtServer();
    try {
      ok(await h.call("engine_healthcheck"));
      ok(await h.call("engine_healthcheck"));
      assert.equal(session.bootstraps, 1);
      assert.equal(srv.requests.filter((r) => r.path.includes("/qps/csrftoken")).length, 1);
    } finally {
      await h.close();
    }
  });

  test("an expired session (401) is re-bootstrapped once and the call succeeds", async () => {
    const { h, session } = await jwtServer();
    try {
      ok(await h.call("engine_healthcheck"));
      valid.clear(); // the proxy drops the session
      const body = ok(await h.call("engine_healthcheck"));
      assert.equal(body.version, HEALTH.version);
      assert.equal(session.bootstraps, 2);
      assert.equal(srv.requests.at(-1).headers.cookie, "X-Qlik-Session-jwt=sess-2");
    } finally {
      await h.close();
    }
  });

  test("a persistent 401 is retried exactly once, then reported (never loops)", async () => {
    const { h, session } = await jwtServer();
    try {
      ok(await h.call("engine_healthcheck"));
      valid.clear();
      const before = srv.requests.length;
      acceptNew = false; // every new session is rejected too
      expectToolError(await h.call("engine_healthcheck"), { code: "AUTH_ERROR", details: { status: 401 } });
      const hits = srv.requests.slice(before).filter((r) => r.path.startsWith("/jwt/engine/healthcheck/")).length;
      assert.equal(hits, 2, "original attempt + one retry");
      assert.equal(session.bootstraps, 2);
    } finally {
      await h.close();
    }
  });

  test("a 403 on a fresh session is a rule denial: no re-bootstrap", async () => {
    const { h, session } = await jwtServer();
    try {
      ok(await h.call("engine_healthcheck"));
      valid.clear();
      reject = 403;
      expectToolError(await h.call("engine_healthcheck"), { code: "AUTH_ERROR", details: { status: 403 } });
      assert.equal(session.bootstraps, 1);
    } finally {
      await h.close();
    }
  });

  test("a bad JWT fails the bootstrap with AUTH_ERROR", async () => {
    minted = 0; valid = new Set(); reject = 401; acceptNew = true;
    const cfg = { ...loopbackConfig(srv.port, { authMode: "jwt", rootCaOnly: true }), jwt: "wrong.jwt.token" };
    const h = await startServer({ cfg, deps: { session: new ProxySession(cfg) } });
    try {
      expectToolError(await h.call("engine_healthcheck"), { code: "AUTH_ERROR", messageIncludes: "csrftoken" });
    } finally {
      await h.close();
    }
  });
});
