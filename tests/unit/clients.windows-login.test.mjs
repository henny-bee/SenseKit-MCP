// windows mode: the forms login against a loopback "proxy", the QRS client
// on the resulting session (default proxy, no prefix), the re-login on a
// login redirect, and the guards that keep the password and the Windows
// account safe (no re-post after a rejection, no redirect off the proxy).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { TEST_CERT, TEST_KEY } from "../helpers/loopback-https.mjs";
import { makeConfig } from "../helpers/harness.mjs";
import { ProxySession } from "../../dist/clients/proxy-session.js";
import { QrsClient } from "../../dist/clients/qrs.js";
import { EngineClient } from "../../dist/clients/engine.js";

const USER = "WESTARP\\tester";
const PASSWORD = "p@ss word&=1";

/** A fake forms-login proxy. `opts.password` is the one it accepts,
 *  `opts.csrf: false` mimics a proxy without /qps/csrftoken, and
 *  `opts.loginHost` puts another host into the login redirect. */
async function startProxy(opts = {}) {
  const requests = [];
  let sessions = 0;
  const live = new Set();
  const state = { expire: () => live.clear() };
  const server = https.createServer({ cert: TEST_CERT, key: TEST_KEY }, (req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: req.method, path: req.url, headers: req.headers, body });
      const base = `https://${opts.loginHost ?? "127.0.0.1"}:${port}`;
      const url = new URL(req.url, base);
      const cookie = /X-Qlik-Session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
      const authed = cookie && live.has(cookie);
      const send = (status, headers = {}, text = "") => { res.writeHead(status, headers); res.end(text); };

      if (url.pathname === "/internal_forms_authentication/") {
        if (req.method === "GET") return send(200, { "Content-Type": "text/html" }, "<form>");
        const form = new URLSearchParams(body);
        if (form.get("username") === USER && form.get("pwd") === (opts.password ?? PASSWORD)) {
          return send(302, { Location: `${base}/hub/?qlikTicket=T${++sessions}` });
        }
        return send(200, { "Content-Type": "text/html" }, "<form>wrong</form>");
      }
      if (url.pathname === "/hub/" && url.searchParams.has("qlikTicket")) {
        const s = `S${url.searchParams.get("qlikTicket")}`;
        live.add(s);
        return send(302, { Location: `${base}/hub/`, "Set-Cookie": `X-Qlik-Session=${s}; Path=/; HttpOnly; Secure` });
      }
      if (url.pathname.startsWith("/nope/")) return send(404); // no such virtual proxy
      if (!authed) return send(302, { Location: `${base}/internal_forms_authentication/?targetId=abc` });
      if (url.pathname === "/qps/csrftoken") {
        return opts.csrf === false ? send(404) : send(204, { "qlik-csrf-token": `csrf-${cookie}` });
      }
      if (url.pathname === "/qrs/about") return send(200, { "Content-Type": "application/json" }, JSON.stringify({ buildVersion: "x", session: cookie }));
      return send(404);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return {
    port, requests, state,
    async close() { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); },
  };
}

function windowsConfig(port, overrides = {}) {
  return {
    ...makeConfig({ authMode: "windows" }),
    host: "127.0.0.1",
    proxyPort: port,
    vpPrefix: "",
    ca: Buffer.from(TEST_CERT),
    tlsVerify: true,
    windowsLogin: { username: USER, password: PASSWORD },
    ...overrides,
  };
}

const proxies = [];
async function proxy(opts) { const p = await startProxy(opts); proxies.push(p); return p; }
after(async () => { for (const p of proxies) await p.close(); });

test("login: hub redirect -> form POST -> ticket -> session cookie -> CSRF token", async () => {
  const p = await proxy();
  const s = new ProxySession(windowsConfig(p.port));
  const creds = await s.ensure();
  assert.equal(creds.cookie, "X-Qlik-Session=ST1");
  assert.equal(creds.csrfToken, "csrf-ST1");
  assert.deepEqual(p.requests.map((r) => `${r.method} ${r.path}`), [
    "GET /hub/",
    "POST /internal_forms_authentication/?targetId=abc",
    "GET /hub/?qlikTicket=T1",
    "GET /qps/csrftoken",
  ]);
  const post = p.requests[1];
  assert.equal(post.headers["content-type"], "application/x-www-form-urlencoded");
  const form = new URLSearchParams(post.body);
  assert.equal(form.get("username"), USER);
  assert.equal(form.get("pwd"), PASSWORD);
  // the password goes to the form POST only
  for (const r of p.requests.filter((x) => x !== post)) assert.ok(!JSON.stringify(r).includes(PASSWORD));
});

test("login: a proxy without /qps/csrftoken yields an empty token, and the engine URL then carries none", async () => {
  const p = await proxy({ csrf: false });
  const cfg = windowsConfig(p.port);
  const creds = await new ProxySession(cfg).ensure();
  assert.equal(creds.csrfToken, "");
  const engine = new EngineClient(cfg);
  try {
    assert.equal(engine["wsUrl"]("engineData", creds), `wss://127.0.0.1:${p.port}/app/engineData`);
    assert.equal(engine["wsUrl"]("engineData", { ...creds, csrfToken: "t/1" }), `wss://127.0.0.1:${p.port}/app/engineData?qlik-csrf-token=t%2F1`);
    assert.equal(new EngineClient({ ...cfg, vpPrefix: "win" })["wsUrl"]("x", creds), `wss://127.0.0.1:${p.port}/win/app/x`);
  } finally {
    await engine.close();
  }
});

test("login: a rejected password is posted ONCE; later calls fail without contacting the proxy", async () => {
  const p = await proxy({ password: "something-else" });
  const s = new ProxySession(windowsConfig(p.port));
  await assert.rejects(s.ensure(), (e) => e.code === "AUTH_ERROR" && /rejected for WESTARP\\tester/.test(e.message) && !e.message.includes(PASSWORD));
  const seen = p.requests.length;
  await assert.rejects(s.ensure(), /rejected/);
  await assert.rejects(s.ensure(), /rejected/);
  assert.equal(p.requests.length, seen);
  assert.equal(p.requests.filter((r) => r.method === "POST").length, 1);
});

test("login: a redirect to another host is refused before the password is sent", async () => {
  const p = await proxy({ loginHost: "evil.example.invalid" });
  const s = new ProxySession(windowsConfig(p.port));
  await assert.rejects(s.ensure(), /redirected to https:\/\/evil\.example\.invalid.*nothing was sent there/);
  assert.equal(p.requests.filter((r) => r.method === "POST").length, 0);
});

test("login: a proxy that does not offer the login form says so", async () => {
  const p = await proxy();
  const s = new ProxySession(windowsConfig(p.port, { vpPrefix: "nope" }));
  await assert.rejects(s.ensure(), /GET \/nope\/hub\/ -> 404, expected a redirect to the Qlik login form/);
});

test("QRS on the default proxy: no prefix, session cookie, one login for many calls", async () => {
  const p = await proxy();
  const cfg = windowsConfig(p.port);
  const qrs = new QrsClient(cfg, new ProxySession(cfg));
  const a = await qrs.get("/qrs/about");
  const b = await qrs.get("/qrs/about");
  assert.equal(a.session, "ST1");
  assert.equal(b.session, "ST1");
  const calls = p.requests.filter((r) => r.path.startsWith("/qrs/"));
  assert.equal(calls.length, 2);
  for (const r of calls) {
    assert.match(r.path, /^\/qrs\/about\?xrfkey=[0-9a-f]{16}$/);
    assert.equal(r.headers.cookie, "X-Qlik-Session=ST1");
    assert.equal(r.headers.authorization, undefined);
  }
  assert.equal(p.requests.filter((r) => r.method === "POST").length, 1);
});

test("QRS: a login redirect on an expired session logs in again and retries once", async () => {
  const p = await proxy();
  const cfg = windowsConfig(p.port);
  const session = new ProxySession(cfg);
  const qrs = new QrsClient(cfg, session);
  assert.equal((await qrs.get("/qrs/about")).session, "ST1");
  p.state.expire();
  assert.equal((await qrs.get("/qrs/about")).session, "ST2");
  assert.equal(session.bootstraps, 2);
});

test("QRS: a redirect is never returned as data", async () => {
  const p = await proxy();
  const cfg = windowsConfig(p.port);
  // creds the proxy never issued: every call is redirected to the login
  const stuck = new ProxySession(cfg, { bootstrap: async () => ({ cookie: "X-Qlik-Session=bogus", csrfToken: "" }) });
  await assert.rejects(new QrsClient(cfg, stuck).get("/qrs/about"),
    (e) => e.code === "AUTH_ERROR" && e.details.status === 302 && /redirected to the proxy login/.test(e.message));
  assert.equal(stuck.bootstraps, 2);
});
