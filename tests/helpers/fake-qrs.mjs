// Deterministic in-memory stand-in for the QRS REST client.
//
// Same surface as src/clients/qrs.ts (get/post/put/delete/request), routed
// against a small fixed site: two streams, three apps, reload tasks in
// several states, a data connection and a virtual proxy carrying secrets
// (from tests/fixtures), and a security-rule set that trips every lint.
//
//   const qrs = createFakeQrs();                 // default site
//   const qrs = createFakeQrs({ routes: [...] }) // extra routes win
//   qrs.calls  -> [{ method, path, body }]       // what reached the "wire"
//
// `calls` exists so a test can check what a tool ASKED the repository for
// (a filter, a stream id) — part of the tool's contract with QRS — not to
// count requests. Errors mimic the real client (see qrsHttpError).

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ToolError, httpErrorCode } from "../../dist/core/errors.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
export const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
/** An HTTP failure exactly as src/clients/qrs.ts raises it: a ToolError
 *  whose code is derived from the status, with { status, method, path }.
 *  Use it in custom routes to simulate a QRS error. */
export function qrsHttpError(status, method, path, body = "") {
  return new ToolError(httpErrorCode(status, "QRS_ERROR"), `QRS ${method} ${path} -> ${status}: ${body}`, { status, method, path });
}

const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

export const TASK_OK = "aaaaaaaa-0000-0000-0000-000000000001";
export const TASK_FAILED = "aaaaaaaa-0000-0000-0000-000000000002";
export const TASK_NEVER_RUN = "aaaaaaaa-0000-0000-0000-000000000003";
export const TASK_NO_LOG = "aaaaaaaa-0000-0000-0000-000000000004";
export const STREAM_EVERYONE = "bbbbbbbb-0000-0000-0000-000000000001";
export const STREAM_OBRIEN = "bbbbbbbb-0000-0000-0000-000000000002";
export const COPY_APP_ID = "cccccccc-0000-0000-0000-000000000001";
const NIL_GUID = "00000000-0000-0000-0000-000000000000";
const LOG_REF = "dddddddd-0000-0000-0000-000000000001";

const owner = (userId, userDirectory = "LAB") => ({ userId, userDirectory });

/** Build the default site. A fresh copy per fake, so tests cannot leak
 *  state into each other. */
export function defaultSite() {
  const streams = [
    { id: STREAM_EVERYONE, name: "Everyone", owner: owner("sa_repository", "INTERNAL") },
    { id: STREAM_OBRIEN, name: "O'Brien", owner: owner("obrien") },
  ];
  const tasks = [
    { id: TASK_OK, name: "Nightly Sales", enabled: true, app: { id: "app-1", name: "Sales" },
      operational: { lastExecutionResult: { status: 7, startTime: "2026-10-01T02:00:00Z", stopTime: "2026-10-01T02:03:00Z", duration: 180000, fileReferenceID: LOG_REF, details: [] } } },
    { id: TASK_FAILED, name: "Finance Reload", enabled: true, app: { id: "app-2", name: "Finance" },
      operational: { lastExecutionResult: {
        status: 8, startTime: "2026-10-01T03:00:00Z", stopTime: "2026-10-01T03:00:09Z", duration: 9000,
        executingNodeName: "node1", fileReferenceID: LOG_REF,
        details: [
          { detailCreatedDate: "2026-10-01T03:00:00Z", detailsType: 2, message: "Reload started" },
          { detailCreatedDate: "2026-10-01T03:00:09Z", detailsType: 3, message: "Connector error: login failed for pwd=s3cret" },
        ],
      } } },
    { id: TASK_NEVER_RUN, name: "Never Run", enabled: false, app: { id: "app-3", name: "Draft" }, operational: {} },
    { id: TASK_NO_LOG, name: "Weird Status", enabled: true, app: { id: "app-3", name: "Draft" },
      operational: { lastExecutionResult: { status: 99, fileReferenceID: NIL_GUID, details: [] } } },
  ];
  return {
    about: { buildVersion: "14.212.6", buildDate: "2026-05-01", databaseProvider: "Devart.Data.PostgreSql", nodeType: 1, sharedPersistence: true },
    servicestatus: [
      { serviceType: 0, serviceState: 2, serverNodeConfiguration: { hostName: "node1.example.invalid" } },
      { serviceType: 3, serviceState: 2, serverNodeConfiguration: { hostName: "node1.example.invalid" } },
      { serviceType: 2, serviceState: 3, serverNodeConfiguration: { name: "node2" } },
      { serviceType: 42, serviceState: 77, serverNodeConfiguration: { hostName: "node3" } },
    ],
    license: { serial: "9999000000001234", name: "Fake Org", organization: "Fake Org", isExpired: false, isSubscription: true, keyDetails: "Valid until 2027-01-01" },
    professional: [{ user: owner("alice") }, { user: owner("bob") }],
    analyzer: [{ user: owner("carol") }],
    apps: [
      { id: "app-1", name: "Sales", owner: owner("alice"), stream: { name: "Everyone" }, published: true, lastReloadTime: "2026-10-01T02:03:00Z", fileSize: 2048 },
      { id: "app-2", name: "Finance", owner: owner("bob"), stream: null, published: false, lastReloadTime: "2026-10-01T03:00:09Z", fileSize: 4096 },
      { id: "app-3", name: "Draft", owner: owner("carol"), published: false, lastReloadTime: null, fileSize: 512 },
    ],
    streams,
    tasks,
    users: [
      { id: "u1", userDirectory: "LAB", userId: "alice", name: "Alice", roles: ["RootAdmin"], inactive: false, removedExternally: false },
      { id: "u2", userDirectory: "LAB", userId: "bob", name: "Bob", roles: [], inactive: true, removedExternally: false },
    ],
    extensions: [{ id: "ext-1", name: "fake-extension-viz", owner: owner("alice") }],
    dataconnections: [fixture("dataconnection_full.json")],
    virtualproxies: [fixture("virtualproxy_full.json")],
    systemrules: [
      { id: "r1", name: "Stream", type: "Default", disabled: false, resourceFilter: "Stream_*", actions: 2, rule: "resource.HasPrivilege(\"read\")", category: "Security" },
      { id: "r2", name: "ContentAdmin", type: "Default", disabled: true, resourceFilter: "App_*", actions: 2, rule: "user.roles=\"ContentAdmin\"", category: "Security" },
      { id: "r3", name: "Everything", type: "Custom", disabled: false, resourceFilter: "*", actions: 2, rule: "user.name like \"*\"", category: "Security" },
      { id: "r4", name: "God mode", type: "Custom", disabled: false, resourceFilter: "App_*", actions: 12, rule: "true", category: "Security", comment: "temporary" },
      { id: "r5", name: "Old rule", type: "Custom", disabled: true, resourceFilter: "Stream_*", actions: 2, rule: "false", category: "Security" },
    ],
    scriptLog: Array.from({ length: 12 }, (_, i) => `2026-10-01 03:00:0${i % 10} line ${i + 1}${i === 10 ? " CONNECT TO 'Provider=x;PWD=s3cret;'" : ""}`).join("\r\n") + "\r\n",
  };
}

/** Parse the one filter shape the tools build themselves:
 *  `name eq '<value>'` with qrsQuote escaping. Anything else returns null
 *  (meaning: the fake does not filter, it just records the path). */
function nameEq(path) {
  const q = path.indexOf("?filter=");
  if (q < 0) return null;
  const filter = decodeURIComponent(path.slice(q + 8).split("&")[0]);
  const m = /^name eq '((?:\\.|[^'\\])*)'$/.exec(filter);
  return m ? m[1].replace(/\\(.)/g, "$1") : null;
}

/**
 * @param {object} [opts]
 * @param {Array<[string, RegExp, (m: RegExpMatchArray, body: any, site: object, path: string) => any]>} [opts.routes]
 *        extra [method, pathRegex, handler] routes, tried before the defaults;
 *        a handler may throw to simulate a QRS error
 * @param {(site: object) => void} [opts.tweak] edit the default site before use
 */
export function createFakeQrs(opts = {}) {
  const site = defaultSite();
  opts.tweak?.(site);
  const calls = [];
  const notFound = (method, path) => { throw qrsHttpError(404, method, path, "Not Found"); };
  const byNameOr = (path, list) => {
    const name = nameEq(path);
    return clone(name === null ? list : list.filter((x) => x.name === name));
  };

  const routes = [
    ...(opts.routes ?? []),
    ["GET", /^\/qrs\/about(\?|$)/, () => site.about],
    ["GET", /^\/qrs\/servicestatus\/full/, () => site.servicestatus],
    ["GET", /^\/qrs\/license\/professionalaccesstype\/full/, () => site.professional],
    ["GET", /^\/qrs\/license\/analyzeraccesstype\/full/, () => site.analyzer],
    ["GET", /^\/qrs\/license(\?|$)/, () => site.license],
    ["GET", /^\/qrs\/app\/full/, (_m, _b, s, path) => byNameOr(path, s.apps)],
    ["GET", /^\/qrs\/stream\/full/, (_m, _b, s, path) => byNameOr(path, s.streams)],
    ["GET", /^\/qrs\/reloadtask\/full/, (_m, _b, s, path) => byNameOr(path, s.tasks)],
    ["GET", /^\/qrs\/reloadtask\/([0-9a-f-]{36})\/scriptlog\?fileReferenceId=([0-9a-f-]{36})/, (m) => `temp-${m[2]}`],
    ["GET", /^\/qrs\/download\/reloadtask\/temp-[0-9a-f-]+\/scriptlog\.txt/, (_m, _b, s) => s.scriptLog],
    ["GET", /^\/qrs\/reloadtask\/([0-9a-f-]{36})(\?|$)/, (m, _b, s, path) => s.tasks.find((t) => t.id === m[1]) ?? notFound("GET", path)],
    ["GET", /^\/qrs\/user\/full/, (_m, _b, s) => s.users],
    ["GET", /^\/qrs\/extension\/full/, (_m, _b, s) => s.extensions],
    ["GET", /^\/qrs\/dataconnection(\/full)?(\?|$)/, (_m, _b, s) => s.dataconnections],
    ["GET", /^\/qrs\/virtualproxyconfig(\/full)?(\?|$)/, (_m, _b, s) => s.virtualproxies],
    ["GET", /^\/qrs\/systemrule\/full/, (_m, _b, s) => s.systemrules],
    ["GET", /^\/qrs\/tag(\/full)?(\?|$)/, () => [{ id: "t1", name: "prod" }, { id: "t2", name: "dev" }]],
    ["POST", /^\/qrs\/task\/([0-9a-f-]{36})\/start/, () => undefined],
    ["POST", /^\/qrs\/app\/([0-9a-f-]{36})\/copy\?name=([^&]*)/, (m) => ({ id: COPY_APP_ID, name: decodeURIComponent(m[2]) })],
    ["PUT", /^\/qrs\/app\/([0-9a-f-]{36})\/publish\?stream=([0-9a-f-]{36})/, (m, _b, s) => ({
      id: m[1], name: "Fake Sales", published: true, stream: { id: m[2], name: s.streams.find((x) => x.id === m[2])?.name },
    })],
    ["DELETE", /^\/qrs\/app\/([0-9a-f-]{36})$/, () => undefined],
  ];

  async function request(method, path, body) {
    calls.push({ method, path, body });
    for (const [m, re, handler] of routes) {
      if (m !== method) continue;
      const match = re.exec(path);
      if (match) return clone(await handler(match, body, site, path));
    }
    // Unknown GET collections answer [] like an empty QRS entity list.
    if (method === "GET" && /^\/qrs\/[a-z]+(\/full)?(\?|$)/.test(path)) return [];
    return notFound(method, path);
  }

  return {
    site,
    calls,
    request,
    get: (p) => request("GET", p),
    post: (p, b) => request("POST", p, b),
    put: (p, b) => request("PUT", p, b),
    delete: (p) => request("DELETE", p),
  };
}
