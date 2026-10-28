import { test } from "node:test";
import assert from "node:assert/strict";
import { ProxySession, sessionRejection, STALE_SESSION_MIN_AGE_MS } from "../../dist/clients/proxy-session.js";
import { ToolError } from "../../dist/core/errors.js";

const cfg = { host: "qlik.example.invalid", proxyPort: 443, vpPrefix: "jwt", jwt: "a.b.c", tlsVerify: true };
const http = (status) => new ToolError(status === 404 ? "NOT_FOUND" : "AUTH_ERROR", `QRS GET /qrs/about -> ${status}: no`, { status, method: "GET", path: "/qrs/about" });

function session() {
  const clock = { t: 1_000_000 };
  let n = 0;
  const s = new ProxySession(cfg, {
    bootstrap: async () => { n++; return { cookie: `X-Qlik-Session-jwt=s${n}`, csrfToken: `c${n}` }; },
    now: () => clock.t,
  });
  return { s, clock };
}

function op(...failures) {
  const seen = [];
  const fn = async (creds) => {
    seen.push(creds.cookie);
    const f = failures.shift();
    if (f) throw f;
    return "ok";
  };
  return { fn, seen };
}

test("sessionRejection: classifies proxy session rejections only", () => {
  assert.deepEqual(sessionRejection(http(401)), { status: 401 });
  assert.deepEqual(sessionRejection(http(403)), { status: 403 });
  assert.equal(sessionRejection(http(404)), undefined);
  // forms-login proxies redirect a dead session to the login page: a 401
  assert.deepEqual(sessionRejection(http(302)), { status: 401 });
  assert.equal(sessionRejection(new ToolError("QRS_ERROR", "x", { status: 500 })), undefined);
  // engine websocket upgrade: status only in the message
  assert.deepEqual(sessionRejection(new ToolError("AUTH_ERROR", "engine session open failed: Unexpected server response: 401")), { status: 401 });
  assert.equal(sessionRejection(new ToolError("AUTH_ERROR", "CSRF bootstrap: no qlik-csrf-token response header")), undefined);
  // socket closed before the session opened: rejection without a status
  assert.deepEqual(sessionRejection(new ToolError("ENGINE_ERROR", "engine session open failed: socket closed")), {});
  assert.equal(sessionRejection(new ToolError("ENGINE_ERROR", "openDoc(x) failed: App not found")), undefined);
  assert.equal(sessionRejection(Object.assign(new Error("x"), { details: { status: 401 } })), undefined);
  assert.equal(sessionRejection("401"), undefined);
});

test("ensure: one bootstrap, shared by concurrent callers and reused afterwards", async () => {
  const { s } = session();
  const all = await Promise.all([s.ensure(), s.ensure(), s.ensure()]);
  assert.equal(new Set(all.map((c) => c.cookie)).size, 1);
  await s.ensure();
  assert.equal(s.bootstraps, 1);
});

test("run: success uses the cached session, no retry", async () => {
  const { s } = session();
  const o = op();
  assert.equal(await s.run(o.fn), "ok");
  assert.equal(await s.run(o.fn), "ok");
  assert.equal(s.bootstraps, 1);
  assert.deepEqual(o.seen, ["X-Qlik-Session-jwt=s1", "X-Qlik-Session-jwt=s1"]);
});

test("run: a 401 re-bootstraps and retries once with the NEW session", async () => {
  const { s } = session();
  const o = op(http(401));
  assert.equal(await s.run(o.fn), "ok");
  assert.equal(s.bootstraps, 2);
  assert.deepEqual(o.seen, ["X-Qlik-Session-jwt=s1", "X-Qlik-Session-jwt=s2"]);
});

test("run: a persistent 401 makes exactly two attempts, then throws (never loops)", async () => {
  const { s } = session();
  const o = op(http(401), http(401), http(401));
  await assert.rejects(s.run(o.fn), (e) => e instanceof ToolError && e.details.status === 401);
  assert.equal(o.seen.length, 2);
  assert.equal(s.bootstraps, 2);
});

test("run: a 403 on a fresh session is not retried; after the stale age it is", async () => {
  const { s, clock } = session();
  const fresh = op(http(403));
  await assert.rejects(s.run(fresh.fn), /403/);
  assert.equal(fresh.seen.length, 1);
  assert.equal(s.bootstraps, 1);

  clock.t += STALE_SESSION_MIN_AGE_MS + 1_000;
  const stale = op(http(403));
  assert.equal(await s.run(stale.fn), "ok");
  assert.equal(stale.seen.length, 2);
  assert.equal(s.bootstraps, 2);
});

test("run: a socket closed at open retries only for a stale session", async () => {
  const closed = () => new ToolError("ENGINE_ERROR", "engine session open failed: socket closed");
  const { s, clock } = session();
  await assert.rejects(s.run(op(closed()).fn), /socket closed/);
  assert.equal(s.bootstraps, 1);
  clock.t += STALE_SESSION_MIN_AGE_MS;
  assert.equal(await s.run(op(closed()).fn), "ok");
  assert.equal(s.bootstraps, 2);
});

test("run: other errors propagate untouched with no retry", async () => {
  const { s } = session();
  for (const err of [http(404), new ToolError("QRS_ERROR", "boom", { status: 500 }), new TypeError("bug")]) {
    const o = op(err);
    await assert.rejects(s.run(o.fn), (e) => e === err);
    assert.equal(o.seen.length, 1);
  }
  assert.equal(s.bootstraps, 1);
});

test("run: concurrent 401s on one dead session trigger ONE re-bootstrap", async () => {
  const { s } = session();
  await s.ensure();
  const dead = "X-Qlik-Session-jwt=s1";
  const fn = async (creds) => {
    await new Promise((r) => setImmediate(r));
    if (creds.cookie === dead) throw http(401);
    return creds.cookie;
  };
  const results = await Promise.all([s.run(fn), s.run(fn), s.run(fn)]);
  assert.deepEqual(results, ["X-Qlik-Session-jwt=s2", "X-Qlik-Session-jwt=s2", "X-Qlik-Session-jwt=s2"]);
  assert.equal(s.bootstraps, 2);
});

test("invalidate(stale) only drops the cache when those creds are still current", async () => {
  const { s } = session();
  const first = await s.ensure();
  s.invalidate();
  const second = await s.ensure();
  assert.notEqual(second.cookie, first.cookie);
  s.invalidate(first); // outdated creds: no effect
  assert.equal((await s.ensure()).cookie, second.cookie);
  assert.equal(s.bootstraps, 2);
});

test("a failed bootstrap is not cached: the next call bootstraps again", async () => {
  let calls = 0;
  const s = new ProxySession(cfg, {
    bootstrap: async () => { calls++; if (calls === 1) throw new ToolError("AUTH_ERROR", "CSRF bootstrap -> 401", { status: 401 }); return { cookie: "X-Qlik-Session=ok", csrfToken: "t" }; },
  });
  await assert.rejects(s.ensure(), /401/);
  assert.equal((await s.ensure()).cookie, "X-Qlik-Session=ok");
  assert.equal(calls, 2);
});
