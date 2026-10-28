import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets, scrubString, REDACTED } from "../../dist/core/redact.js";
import { fixture } from "./_helpers.mjs";

test("redactSecrets masks credential fields but keeps empty/null", () => {
  const dc = redactSecrets(fixture("dataconnection_full.json"));
  assert.equal(dc.password, "***REDACTED***");
  assert.equal(dc.passphrase, "");
  assert.equal(dc.username, "svc_qlik");
  assert.equal(dc.owner.userId, "svc_qlik");
});

test("redactSecrets scrubs key=value secrets inside connection strings", () => {
  const dc = redactSecrets(fixture("dataconnection_full.json"));
  assert.ok(!dc.connectionstring.includes("SuperSecret123"));
  assert.ok(dc.connectionstring.includes("PWD=***REDACTED***"));
  assert.ok(dc.connectionstring.includes("Data Source=warehouse.internal"));
});

test("redactSecrets handles arrays and non-objects", () => {
  const arr = redactSecrets([{ password: "x" }, "pwd=abc;", 42, null]);
  assert.equal(arr[0].password, "***REDACTED***");
  assert.equal(arr[1], "pwd=***REDACTED***;");
  assert.equal(arr[2], 42);
  assert.equal(arr[3], null);
});

test("redactSecrets masks camelCase-prefixed credential fields", () => {
  // Regression: an anchored key regex leaked oidcClientSecret verbatim.
  const vp = redactSecrets(fixture("virtualproxy_full.json"));
  assert.equal(vp.oidcClientSecret, REDACTED);
  assert.equal(vp.samlClientSecret, REDACTED);
  assert.ok(!JSON.stringify(vp).includes("SYNTHETIC~not~a~real"));
});

test("redactSecrets keeps non-credential look-alike fields intact", () => {
  const vp = redactSecrets(fixture("virtualproxy_full.json"));
  assert.equal(vp.oidcClientId, "11111111-2222-3333-4444-555555555555");
  assert.equal(vp.oidcAttributeClientId, "aud");
  assert.equal(vp.hasSecureAttributeHttps, true);
  assert.equal(vp.sessionCookieHeaderName, "X-Qlik-Session-oidc");
  assert.equal(vp.anonymousAccessMode, 0);
  assert.ok(vp.jwtPublicKeyCertificate.includes("BEGIN CERTIFICATE"));
});

test("redactSecrets matches credential key names with prefixes and suffixes", () => {
  const out = redactSecrets({
    oidcClientSecret: "a", DB_PASSWORD: "b", apiKey2: "c",
    vPassphrase: "d", privateKeyPem: "e", refresh_token: "f",
    clientId: "keep", publicKey: "keep", secureFlag: "keep", username: "keep",
  });
  for (const k of ["oidcClientSecret", "DB_PASSWORD", "apiKey2", "vPassphrase", "privateKeyPem", "refresh_token"]) {
    assert.equal(out[k], REDACTED, `expected ${k} to be redacted`);
  }
  for (const k of ["clientId", "publicKey", "secureFlag", "username"]) {
    assert.equal(out[k], "keep", `expected ${k} to survive`);
  }
});

test("redactSecrets masks name/value PAIRS that name a credential", () => {
  // The secret sits under "value", identifiable only by its sibling "name".
  const udc = redactSecrets({
    name: "LDAP-Corp",
    settings: [
      { id: "1", name: "Username", value: "svc_bind" },
      { id: "2", name: "Password", value: "hunter2" },
      { id: "3", name: "Host", value: "ldap.internal" },
      { id: "4", settingName: "Client Secret", value: "shh" },
    ],
  });
  assert.equal(udc.settings[0].value, "svc_bind");
  assert.equal(udc.settings[1].value, REDACTED);
  assert.equal(udc.settings[2].value, "ldap.internal");
  assert.equal(udc.settings[3].value, REDACTED); // settingName variant
  assert.equal(udc.settings[1].name, "Password");
  assert.equal(udc.name, "LDAP-Corp");
});

test("scrubString masks quoted and bare values, prefixed key names", () => {
  assert.equal(scrubString("SET vPassword = 'hunter2';"), `SET vPassword = ${REDACTED};`);
  assert.equal(scrubString('LET vApiKey = "abc-123";'), `LET vApiKey = ${REDACTED};`);
  assert.equal(scrubString("CUSTOM CONNECT TO \"provider=X;pwd=topsecret;host=y\";"),
    `CUSTOM CONNECT TO \"provider=X;pwd=${REDACTED};host=y\";`);
  assert.equal(scrubString("0007 LET vClient_Secret = 'shh'"), `0007 LET vClient_Secret = ${REDACTED}`);
  const clean = "LOAD OrderId, Region FROM [lib://X/y.qvd] (qvd);";
  assert.equal(scrubString(clean), clean);
});
