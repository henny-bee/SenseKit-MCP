import { test } from "node:test";
import assert from "node:assert/strict";
import { RENDER_ERROR, browserCookie, sheetUrl } from "../../dist/clients/browser.js";

const cfg = { host: "qlik.example.invalid", proxyPort: 443, vpPrefix: "" };

test("sheetUrl: analysis state on the proxy, with the virtual proxy prefix when set", () => {
  assert.equal(sheetUrl(cfg, "app-1", "s 1"), "https://qlik.example.invalid:443/sense/app/app-1/sheet/s%201/state/analysis");
  assert.equal(sheetUrl({ ...cfg, vpPrefix: "jwt" }, "a", "s"), "https://qlik.example.invalid:443/jwt/sense/app/a/sheet/s/state/analysis");
});

test("browserCookie: splits at the first '=' and keeps a prefixed proxy's cookie name", () => {
  const c = browserCookie(cfg, "X-Qlik-Session-jwt=ab=c");
  assert.deepEqual([c.name, c.value, c.domain, c.secure], ["X-Qlik-Session-jwt", "ab=c", "qlik.example.invalid", true]);
});

test("RENDER_ERROR: the client's error states in English and German, not ordinary titles", () => {
  for (const s of ["Incomplete visualization", "Invalid dimension", "This chart cannot be displayed", "Package License Expired",
    "Unvollständige Visualisierung", "Ungültige Kennzahl", "Das Diagramm kann nicht angezeigt werden"]) {
    assert.match(s, RENDER_ERROR);
  }
  assert.doesNotMatch("Sales & Margin · Executive View", RENDER_ERROR);
});
