// Test harness: the real server (dist/server.js createServer) wired to the
// fakes, driven through a real MCP client over the SDK's in-memory
// transport. Every tool call goes through JSON-RPC, zod input validation,
// the handler and the SDK's error wrapping, exactly as a client sees it.
//
//   const h = await startServer({ allowMutations: false });
//   after(() => h.close());
//   const res = await h.call("list_sheets", { appId: APP_ID });
//   const body = ok(res);                         // asserts !isError, parses JSON
//   expectToolError(res, { code: "NOT_FOUND", messageIncludes: "refusing" });
//
// Requires a build (npm test builds first).

import assert from "node:assert/strict";
import { createServer } from "../../dist/server.js";
import { ERROR_CODES as CONTRACT_ERROR_CODES } from "./inventory.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFakeEngine, APP_ID } from "./fake-engine.mjs";
import { createFakeQrs } from "./fake-qrs.mjs";

export { APP_ID } from "./fake-engine.mjs";

/** A complete Config (src/config.ts) for an unreachable host. Tests never
 *  touch the network: the engine and QRS clients are fakes. */
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

/**
 * Start a server + connected client. Options are makeConfig() options plus
 * optional pre-built fakes (`fake` from createFakeEngine, `qrs` from
 * createFakeQrs) and `deps` merged into the createServer() deps.
 */
export async function startServer(opts = {}) {
  const fake = opts.fake ?? createFakeEngine(opts.engineOptions);
  const qrs = opts.qrs ?? createFakeQrs(opts.qrsOptions);
  const cfg = opts.cfg ?? makeConfig(opts);
  const server = createServer({ cfg, engine: fake.engine, qrs, ...(opts.deps ?? {}) });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "qlik-sense-mcp-tests", version: "0.0.0" });
  await client.connect(clientSide);

  let toolCache;
  const h = {
    cfg, fake, doc: fake.doc, qrs, server, client,
    /** Raw CallToolResult. */
    call: (name, args = {}) => client.callTool({ name, arguments: args }),
    /** Same, with appId defaulted to the fake app. */
    callApp: (name, args = {}) => client.callTool({ name, arguments: { appId: APP_ID, ...args } }),
    /** tools/list, cached per server. */
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

// ── Result helpers ───────────────────────────────────────────────────────────

/** First text block of a result. */
export const textOf = (res) => res?.content?.[0]?.text ?? "";

/** Parse the first text block as JSON, falling back to the raw string. */
export function parse(res) {
  const t = textOf(res);
  try { return JSON.parse(t); } catch { return t; }
}

/** Assert success and return the parsed body. */
export function ok(res) {
  assert.notEqual(res.isError, true, `expected success, got error: ${textOf(res)}`);
  return parse(res);
}

/**
 * Normalize a tool error. Handler failures are structured: JSON text
 * { code, message, details? } (src/tools/error-boundary.ts). Errors raised by
 * the MCP SDK itself (unknown tool, input-schema violation) are plain text.
 */
export function toolError(res) {
  assert.equal(res.isError, true, `expected isError: true, got success: ${textOf(res).slice(0, 400)}`);
  const t = textOf(res);
  let body;
  try { body = JSON.parse(t); } catch { /* plain text */ }
  if (body && typeof body === "object" && typeof body.message === "string") {
    return { structured: true, code: body.code, message: body.message, details: body.details, raw: t };
  }
  return { structured: false, code: undefined, message: t, details: undefined, raw: t };
}

/** Every handler refusal must carry one of these codes. */
const ERROR_CODES = new Set(CONTRACT_ERROR_CODES);

/** Recursive "expected is a subset of actual" for details checks. */
function assertSubset(actual, expected, path = "details") {
  if (expected === null || typeof expected !== "object") {
    assert.deepEqual(actual, expected, path);
    return;
  }
  assert.ok(actual !== null && typeof actual === "object", `${path}: expected an object, got ${JSON.stringify(actual)}`);
  for (const [k, v] of Object.entries(expected)) assertSubset(actual[k], v, `${path}.${k}`);
}

/**
 * Assert a structured handler refusal: isError, a JSON payload, the given
 * `code`, a message containing every `messageIncludes` needle (string,
 * case-insensitive, or RegExp), and optionally `details` as a subset match.
 * For SDK-level errors (no handler ran) use expectSdkError / expectInvalidArgs.
 */
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

/** Assert an error produced by the MCP SDK before any handler ran (e.g. an
 *  unknown or unregistered tool): plain text, not a structured payload. */
export function expectSdkError(res, messageIncludes) {
  const e = toolError(res);
  assert.ok(!e.structured, `expected an SDK error, got a handler error: ${e.raw}`);
  for (const n of [].concat(messageIncludes ?? [])) assert.ok(e.raw.includes(n), `SDK error should include "${n}": ${e.raw}`);
  return e;
}

/** Assert the SDK rejected the arguments before the handler ran (zod input
 *  validation), naming the offending parameter. */
export function expectInvalidArgs(res, param) {
  const e = toolError(res);
  assert.match(e.raw, /input validation error|invalid arguments/i, e.raw);
  if (param) assert.ok(e.raw.includes(param), `validation error should name "${param}": ${e.raw}`);
  return e;
}

/** True if any string anywhere in v contains needle. */
export function deepIncludes(v, needle) {
  return JSON.stringify(v).includes(needle);
}
