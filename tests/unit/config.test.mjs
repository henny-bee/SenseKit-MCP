// loadConfig(): environment -> Config, including the root CA that must be
// trusted in every auth mode (QSEOW_ROOT_CERT_PATH).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, trustedCa, usesProxySession, vpPath } from "../../dist/config.js";

const dir = mkdtempSync(join(tmpdir(), "qsm-config-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const file = (name, content) => { const p = join(dir, name); writeFileSync(p, content); return p; };
const EMPTY_ENV = file("empty.env", "");
const CA = file("root.pem", "ROOT-CA");
const CERT = file("client.pem", "CLIENT-CERT");
const KEY = file("client_key.pem", "CLIENT-KEY");

/** loadConfig() under exactly `vars` (every other QSEOW_* var cleared, no
 *  .env file picked up), restoring process.env afterwards. */
function configWith(vars) {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) if (k.startsWith("QSEOW_")) delete process.env[k];
  Object.assign(process.env, { QSEOW_ENV_PATH: EMPTY_ENV }, vars);
  try {
    return loadConfig();
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

test("certificate mode: defaults, cert material, read-only by default", () => {
  const cfg = configWith({ QSEOW_CERT_PATH: CERT, QSEOW_CERT_KEY_PATH: KEY });
  assert.equal(cfg.authMode, "certificate");
  assert.equal(cfg.host, "localhost");
  assert.deepEqual([cfg.qrsPort, cfg.enginePort, cfg.proxyPort, cfg.qpsPort], [4242, 4747, 443, 4243]);
  assert.equal(cfg.cert.cert.toString(), "CLIENT-CERT");
  assert.equal(cfg.cert.key.toString(), "CLIENT-KEY");
  assert.deepEqual(cfg.certUser, { directory: "INTERNAL", id: "sa_repository" });
  assert.equal(cfg.tlsVerify, true);
  assert.equal(cfg.allowMutations, false);
  assert.deepEqual([...cfg.toolGroups].sort(), ["admin", "analyst", "developer"]);
  assert.equal(cfg.ca, undefined);
  assert.equal(trustedCa(cfg), undefined);
});

test("certificate mode requires cert and key paths", () => {
  assert.throws(() => configWith({ QSEOW_CERT_PATH: CERT }), /QSEOW_CERT_PATH and QSEOW_CERT_KEY_PATH/);
});

test("jwt mode requires a token; groups, mutations and TLS flags are parsed", () => {
  assert.throws(() => configWith({ QSEOW_AUTH_MODE: "jwt" }), /QSEOW_JWT/);
  const cfg = configWith({
    QSEOW_AUTH_MODE: "jwt", QSEOW_JWT: "a.b.c", QSEOW_TOOL_GROUPS: " Analyst , admin,,", QSEOW_ALLOW_MUTATIONS: "true", QSEOW_TLS_VERIFY: "false",
  });
  assert.equal(cfg.jwt, "a.b.c");
  assert.equal(cfg.cert, undefined);
  assert.deepEqual([...cfg.toolGroups].sort(), ["admin", "analyst"]);
  assert.equal(cfg.allowMutations, true);
  assert.equal(cfg.tlsVerify, false);
  assert.throws(() => configWith({ QSEOW_AUTH_MODE: "saml" }), /QSEOW_AUTH_MODE/);
});

test("windows mode: DOMAIN\\user and a password, default proxy (no prefix), no cert material", () => {
  assert.throws(() => configWith({ QSEOW_AUTH_MODE: "windows" }), /QSEOW_USERNAME and QSEOW_PASSWORD/);
  assert.throws(() => configWith({ QSEOW_AUTH_MODE: "windows", QSEOW_USERNAME: "WESTARP\\me" }), /QSEOW_PASSWORD/);
  assert.throws(() => configWith({ QSEOW_AUTH_MODE: "windows", QSEOW_USERNAME: "me", QSEOW_PASSWORD: "x" }), /DOMAIN\\user/);
  assert.throws(() => configWith({ QSEOW_AUTH_MODE: "windows", QSEOW_USERNAME: "a\\b\\c", QSEOW_PASSWORD: "x" }), /DOMAIN\\user/);
  // the password typed into the username field: refused, and never echoed
  for (const username of ["WESTARP\\Secret9", "Secret9"]) {
    assert.throws(() => configWith({ QSEOW_AUTH_MODE: "windows", QSEOW_USERNAME: username, QSEOW_PASSWORD: "Secret9" }),
      (e) => /contains the password/.test(e.message) && !e.message.includes("Secret9"));
  }
  const cfg = configWith({ QSEOW_AUTH_MODE: "windows", QSEOW_USERNAME: "WESTARP\\me", QSEOW_PASSWORD: "secret" });
  assert.deepEqual(cfg.windowsLogin, { username: "WESTARP\\me", password: "secret" });
  assert.equal(cfg.vpPrefix, "");
  assert.equal(cfg.cert, undefined);
  assert.equal(usesProxySession(cfg), true);
  assert.equal(vpPath(cfg), "");
  const prefixed = configWith({ QSEOW_AUTH_MODE: "windows", QSEOW_USERNAME: "WESTARP\\me", QSEOW_PASSWORD: "secret", QSEOW_VP_PREFIX: "win" });
  assert.equal(vpPath(prefixed), "/win");
});

test("windows mode reads the password from QSEOW_PASSWORD_PATH, minus a BOM and one trailing newline", () => {
  const cfg = configWith({ QSEOW_AUTH_MODE: "windows", QSEOW_USERNAME: "WESTARP\\me", QSEOW_PASSWORD_PATH: file("pw.txt", "﻿ spaced pw \r\n") });
  assert.equal(cfg.windowsLogin.password, " spaced pw ");
});

test("certificate and jwt mode keep their transport and prefix defaults", () => {
  const cert = configWith({ QSEOW_CERT_PATH: CERT, QSEOW_CERT_KEY_PATH: KEY });
  assert.equal(usesProxySession(cert), false);
  assert.equal(cert.windowsLogin, undefined);
  const jwt = configWith({ QSEOW_AUTH_MODE: "jwt", QSEOW_JWT: "a.b.c" });
  assert.equal(usesProxySession(jwt), true);
  assert.equal(vpPath(jwt), "/jwt");
});

test("jwt mode with only QSEOW_ROOT_CERT_PATH: the CA is loaded and trusted, no cert material", () => {
  const cfg = configWith({ QSEOW_AUTH_MODE: "jwt", QSEOW_JWT: "a.b.c", QSEOW_ROOT_CERT_PATH: CA });
  assert.equal(cfg.cert, undefined);
  assert.equal(cfg.ca.toString(), "ROOT-CA");
  assert.equal(trustedCa(cfg).toString(), "ROOT-CA");
});

test("certificate mode with a root CA: trusted CA available on both cfg.ca and cert.ca", () => {
  const cfg = configWith({ QSEOW_CERT_PATH: CERT, QSEOW_CERT_KEY_PATH: KEY, QSEOW_ROOT_CERT_PATH: CA });
  assert.equal(cfg.ca.toString(), "ROOT-CA");
  assert.equal(cfg.cert.ca.toString(), "ROOT-CA");
  assert.equal(trustedCa(cfg).toString(), "ROOT-CA");
});

test("trustedCa prefers cfg.ca and falls back to cert.ca (hand-built configs)", () => {
  const a = Buffer.from("A"), b = Buffer.from("B");
  assert.equal(trustedCa({ ca: a, cert: { ca: b } }), a);
  assert.equal(trustedCa({ cert: { ca: b } }), b);
  assert.equal(trustedCa({}), undefined);
});

test("an unreadable QSEOW_ENV_PATH is an error, not silently ignored", () => {
  assert.throws(() => configWith({ QSEOW_ENV_PATH: join(dir, "missing.env"), QSEOW_CERT_PATH: CERT, QSEOW_CERT_KEY_PATH: KEY }), /QSEOW_ENV_PATH/);
});
