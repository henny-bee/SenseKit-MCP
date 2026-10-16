import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolError, toErrorPayload, httpErrorCode, ERROR_CODES } from "../../dist/core/errors.js";
import { errorResult } from "../../dist/tools/error-boundary.js";

test("httpErrorCode: 401/403 auth, 404 not found, anything else the service's code", () => {
  for (const svc of ["QRS_ERROR", "PROXY_ERROR", "ENGINE_ERROR"]) {
    assert.equal(httpErrorCode(401, svc), "AUTH_ERROR");
    assert.equal(httpErrorCode(403, svc), "AUTH_ERROR");
    assert.equal(httpErrorCode(404, svc), "NOT_FOUND");
    assert.equal(httpErrorCode(400, svc), svc);
    assert.equal(httpErrorCode(500, svc), svc);
    assert.equal(httpErrorCode(undefined, svc), svc);
  }
});

test("toErrorPayload: ToolError keeps code, message and details", () => {
  assert.deepEqual(toErrorPayload(new ToolError("CONFLICT", "dup", { existingId: "m1" })), { code: "CONFLICT", message: "dup", details: { existingId: "m1" } });
  assert.deepEqual(toErrorPayload(new ToolError("NOT_FOUND", "gone")), { code: "NOT_FOUND", message: "gone" });
});

test("toErrorPayload: an enigma-style rejection (numeric code) is ENGINE_ERROR with the engine code", () => {
  const e = Object.assign(new Error("Object not found"), { code: 2 });
  assert.deepEqual(toErrorPayload(e), { code: "ENGINE_ERROR", message: "Object not found", details: { engineCode: 2 } });
});

test("toErrorPayload: anything else is INTERNAL (string codes like ECONNRESET do not count as engine codes)", () => {
  assert.deepEqual(toErrorPayload(new TypeError("x is undefined")), { code: "INTERNAL", message: "x is undefined" });
  assert.equal(toErrorPayload(Object.assign(new Error("reset"), { code: "ECONNRESET" })).code, "INTERNAL");
  assert.deepEqual(toErrorPayload("plain string"), { code: "INTERNAL", message: "plain string" });
  assert.equal(toErrorPayload(undefined).code, "INTERNAL");
});

test("errorResult: isError with JSON { code, message, details } text, secrets redacted", () => {
  const r = errorResult(new ToolError("QRS_ERROR", "QRS GET /x -> 500: Server=db;PWD=hunter2;", { body: "password=hunter2", password: "hunter2" }));
  assert.equal(r.isError, true);
  assert.equal(r.content.length, 1);
  assert.equal(r.content[0].type, "text");
  const body = JSON.parse(r.content[0].text);
  assert.equal(body.code, "QRS_ERROR");
  assert.match(body.message, /PWD=\*\*\*REDACTED\*\*\*/);
  assert.ok(!r.content[0].text.includes("hunter2"), r.content[0].text);
  assert.equal(body.details.password, "***REDACTED***");
});

test("every code a ToolError can carry is in ERROR_CODES", () => {
  assert.ok(ERROR_CODES.length >= 10);
  assert.equal(new Set(ERROR_CODES).size, ERROR_CODES.length, "no duplicates");
});
