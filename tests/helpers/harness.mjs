// Real server + real MCP client over in-memory transport. Needs a build (dist/).
import assert from "node:assert/strict";
import { createServer } from "../../dist/server.js";
import { ERROR_CODES as CONTRACT_ERROR_CODES } from "./inventory.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFakeEngine, APP_ID } from "./fake-engine.mjs";
import { createFakeQrs } from "./fake-qrs.mjs";

export { APP_ID } from "./fake-engine.mjs";

export function makeConfig({ groups = ["analyst", "developer", "admin"], allowMutations = true, cert = false, authMode = "certificate" } = {}) {
  return {
    host: "qlik.example.invalid",
    qrsPort: 4242,
    enginePort: 4747,
    proxyPort: 443,
    qpsPort: 4243,
    authMode,
    vpPrefix: "jwt",
    jwt: authMode === "jwt" ? "header.payload.signature" : undefined,
    cert: cert ? { cert: Buffer.from("fake-cert"), key: Buffer.from("fake-key") } : undefined,
    certUser: { directory: "INTERNAL", id: "sa_repository" },
    tlsVerify: true,
    toolGroups: new Set(groups),
    allowMutations,
  };
}

export async function startServer(opts = {}) {
  const fake = opts.fake ?? createFakeEngine(opts.engineOptions);
  const qrs = opts.qrs ?? createFakeQrs(opts.qrsOptions);
  const cfg = opts.cfg ?? makeConfig(opts);
  const server = createServer({ cfg, engine: fake.engine, qrs, ...(opts.deps ?? {}) });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "sensekit-mcp-tests", version: "0.0.0" });
  await client.connect(clientSide);

  let toolCache;
  const h = {
    cfg, fake, doc: fake.doc, qrs, server, client,
    call: (name, args = {}) => client.callTool({ name, arguments: args }),
    callApp: (name, args = {}) => client.callTool({ name, arguments: { appId: APP_ID, ...args } }),
    async tools() {
      toolCache ??= (await client.listTools()).tools;
      return toolCache;
    },
    async toolNames() { return (await h.tools()).map((t) => t.name).sort(); },
    async tool(name) { return (await h.tools()).find((t) => t.name === name); },
    async close() {
      await client.close();
      await server.close();
    },
  };
  return h;
}

export const textOf = (res) => res?.content?.[0]?.text ?? "";

export function parse(res) {
  const t = textOf(res);
  try { return JSON.parse(t); } catch { return t; }
}

export function ok(res) {
  assert.notEqual(res.isError, true, `expected success, got error: ${textOf(res)}`);
  return parse(res);
}

// Handler errors are JSON { code, message, details? }; SDK errors are plain text.
export function toolError(res) {
  assert.equal(res.isError, true, `expected isError: true, got success: ${textOf(res).slice(0, 400)}`);
  const t = textOf(res);
  let body;
  try { body = JSON.parse(t); } catch {}
  if (body && typeof body === "object" && typeof body.message === "string") {
    return { structured: true, code: body.code, message: body.message, details: body.details, raw: t };
  }
  return { structured: false, code: undefined, message: t, details: undefined, raw: t };
}

const ERROR_CODES = new Set(CONTRACT_ERROR_CODES);

function assertSubset(actual, expected, path = "details") {
  if (expected === null || typeof expected !== "object") {
    assert.deepEqual(actual, expected, path);
    return;
  }
  assert.ok(actual !== null && typeof actual === "object", `${path}: expected an object, got ${JSON.stringify(actual)}`);
  for (const [k, v] of Object.entries(expected)) assertSubset(actual[k], v, `${path}.${k}`);
}

// String needles match case-insensitively; `details` is a subset match.
export function expectToolError(res, { code, messageIncludes, details } = {}) {
  assert.ok(code, "expectToolError needs the expected error code");
  assert.ok(ERROR_CODES.has(code), `"${code}" is not a known error code`);
  const e = toolError(res);
  assert.ok(e.structured, `expected a structured { code, message } error, got: ${e.raw}`);
  assert.equal(e.code, code, `error code: expected ${code}, got ${e.code} (${e.message})`);
  const needles = messageIncludes === undefined ? [] : [].concat(messageIncludes);
  for (const n of needles) {
    if (n instanceof RegExp) assert.match(e.message, n);
    else assert.ok(e.message.toLowerCase().includes(String(n).toLowerCase()), `error message should include "${n}": ${e.message}`);
  }
  if (details !== undefined) assertSubset(e.details, details);
  return e;
}

export function expectSdkError(res, messageIncludes) {
  const e = toolError(res);
  assert.ok(!e.structured, `expected an SDK error, got a handler error: ${e.raw}`);
  for (const n of [].concat(messageIncludes ?? [])) assert.ok(e.raw.includes(n), `SDK error should include "${n}": ${e.raw}`);
  return e;
}

export function expectInvalidArgs(res, param) {
  const e = toolError(res);
  assert.match(e.raw, /input validation error|invalid arguments/i, e.raw);
  if (param) assert.ok(e.raw.includes(param), `validation error should name "${param}": ${e.raw}`);
  return e;
}

export function deepIncludes(v, needle) {
  return JSON.stringify(v).includes(needle);
}
