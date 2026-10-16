#!/usr/bin/env node
// RENDER PROOF — the last mile no engine-side check can cover.
//
// Engine validation proves a definition resolves and computes. It cannot
// prove the client DRAWS it: modern Sense charts are nebula.js supernovas
// rendered in the browser, and a perfectly healthy hypercube can still paint
// nothing. This script drives a real headless browser against a live site and
// reports, per object, whether it actually rendered.
//
// Requires playwright, installed separately so consumers of this package
// don't inherit a browser download:
//   npm i -D playwright && npx playwright install chromium
//
// THE VERDICTS BELOW ARE ADVISORY. Set SHOTS=<dir> and LOOK at the images —
// that is the authority. Qlik draws some error states as SVG text inside a
// shadow root that neither DOM scraping nor Playwright text locators could
// reliably match here; treemap rendered "This chart cannot be displayed."
// while every automated probe reported it as rendering. An automated pixel
// check narrows what a human (or a vision-capable agent) must look at; it
// does not replace looking.
//
// Usage: SHOTS=./shots node scripts/render_proof.mjs <inventory.json>
//   inventory.json: {"appId": "...", "objects": [{"id","viz","title"}, ...]}
//   env: QSEOW_HOST/QSEOW_PROXY_PORT/QSEOW_VP_PREFIX + JWT_PATH (a signed JWT
//        for the virtual proxy). See docs/chart-building.md.
//   screenshots: <SHOTS>/<size>-<NN>-<viz>-<objectId>.png (NN = inventory index)
//   exit code: 0 only if every object "renders" at every size; 1 on any
//        BROKEN / LOAD-FAIL / no-paint, or a failed token bootstrap.
//
// Three lessons are baked into the detection below, all learned the hard way:
//   1. Objects are rendered at SHEET-TILE size, not full viewport. A treemap
//      that paints at 900x620 can refuse in a 640x150 tile. Test both.
//   2. Counting painted SVG nodes is NOT proof: a broken chart still paints
//      its legend. Qlik's error state must be detected explicitly, or the
//      proof reports false PASSes — which is exactly what happened here.
//   3. Error text lives in SVG nodes inside a SHADOW ROOT — neither innerText
//      nor textContent on document.body can see it. Playwright locators
//      pierce open shadow roots; DOM scraping does not. Two false PASSes on
//      treemap came from exactly this.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

// Site config comes from the same env vars as the server. TLS verification is
// only disabled when you explicitly opt out (QSEOW_TLS_VERIFY=false), the same
// switch the server uses for self-signed lab certs — never silently.
const HOST = process.env.QSEOW_HOST || "localhost";
const PORT = process.env.QSEOW_PROXY_PORT || "443";
const PREFIX = process.env.QSEOW_VP_PREFIX || "jwt";
const INSECURE = process.env.QSEOW_TLS_VERIFY === "false";
if (INSECURE) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const inv = JSON.parse(readFileSync(process.argv[2], "utf8"));
const jwt = readFileSync(process.env.JWT_PATH, "utf8").trim();
const base = `https://${HOST}:${PORT}/${PREFIX}`;
const res = await fetch(`${base}/qps/csrftoken`, { headers: { Authorization: `Bearer ${jwt}` } });
if (!res.ok) { console.error(`csrftoken bootstrap -> ${res.status}`); process.exit(1); }
const m = /(X-Qlik-Session[^=]*)=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
if (!m) { console.error("csrftoken bootstrap: no X-Qlik-Session cookie returned"); process.exit(1); }
const SIZES = [
  { name: "8x4-tile", w: 640, h: 300 },
  { name: "small", w: 340, h: 180 },
];
// One file per object AND size: <size>-<index>-<viz>-<objectId>.png. Keyed on
// viz alone, two objects of one type overwrote each other's screenshot.
const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, "_");
const shotName = (size, i, o) => `${size.name}-${String(i + 1).padStart(2, "0")}-${safe(o.viz)}-${safe(o.id)}.png`;
// Anything not proven to render fails the run: BROKEN, LOAD-FAIL and
// no-paint all count, so CI and scripts can trust the exit code.
const failures = [];
const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: INSECURE, viewport: { width: size.w, height: size.h } });
    await ctx.addCookies([{ name: m[1], value: m[2], domain: HOST, path: "/", secure: true, httpOnly: true, sameSite: "None" }]);
    console.log(`\n--- ${size.name} (${size.w}x${size.h}) ---`);
    for (const [i, o] of inv.objects.entries()) {
      const page = await ctx.newPage();
      try {
        await page.goto(`${base}/single/?appid=${encodeURIComponent(inv.appId)}&obj=${o.id}&opt=nointeraction`, { waitUntil: "networkidle", timeout: 40000 });
        await page.waitForTimeout(3000);
        const r = await page.evaluate(() => ({
          painted: document.querySelectorAll("svg rect, svg path, svg circle, canvas, td, .qv-st-value").length,
          // innerText SKIPS SVG text nodes — and Qlik draws "This chart cannot
          // be displayed." as SVG text. Reading only innerText is precisely how
          // this proof reported treemap as rendering while it showed an error.
          txt: ((document.body.innerText || "") + " " + (document.body.textContent || "")).replace(/\s+/g, " "),
          // Qlik paints its error state into a container whose class carries
          // "error" — the legend of a BROKEN chart still renders, so node
          // counting alone reports a false PASS. Check the error state first.
          errorEl: document.querySelectorAll('[class*="error" i]:not([class*="no-error" i])').length,
        }));
        // Playwright locators pierce open shadow roots; this is the only
        // reliable read of Qlik's error state.
        const ERRORS = /cannot be displayed|Invalid visualization|Incomplete visualization|not found on the server/i;
        // getByText takes a RegExp and pierces open shadow roots. A `text=`
        // selector built from regex SOURCE is matched literally and never hits.
        const errCount = await page.getByText(ERRORS).count().catch(() => 0);
        const broken = errCount > 0 ? "Qlik error state" : (r.errorEl > 0 ? "error element present" : null);
        const hasData = /\d/.test(r.txt.replace(/Loading completed|[^\w\s.%]/g, ""));
        const verdict = broken ? `BROKEN(${broken})` : (r.painted > 0 || hasData) ? "renders" : "no-paint(check visually)";
        console.log(`${o.viz.padEnd(13)} ${verdict.padEnd(28)} painted=${String(r.painted).padEnd(4)} ${o.id} ${r.txt.slice(0, 60)}`);
        if (verdict !== "renders") failures.push(`${size.name} ${o.viz} ${o.id}: ${verdict}`);
        if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${shotName(size, i, o)}` });
      } catch (e) {
        console.log(`${o.viz.padEnd(13)} LOAD-FAIL ${o.id} ${String(e?.message ?? e).split("\n")[0].slice(0, 80)}`);
        failures.push(`${size.name} ${o.viz} ${o.id}: LOAD-FAIL`);
      }
      await page.close();
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
const total = SIZES.length * inv.objects.length;
console.log(`\n${total - failures.length}/${total} renders${failures.length ? `; not proven:\n  ${failures.join("\n  ")}` : ""}`);
process.exit(failures.length ? 1 : 0);
