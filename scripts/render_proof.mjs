#!/usr/bin/env node
// Usage: SHOTS=<dir> JWT_PATH=<jwt> node scripts/render_proof.mjs <inventory.json>
// inventory: {"appId", "objects": [{"id","viz","title"}]}; needs playwright.
// Verdicts are advisory (Qlik errors can hide in shadow-root SVG): check the shots.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

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
// Tile sizes: a chart that paints full-viewport can refuse in a sheet tile.
const SIZES = [
  { name: "8x4-tile", w: 640, h: 300 },
  { name: "small", w: 340, h: 180 },
];
const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, "_");
const shotName = (size, i, o) => `${size.name}-${String(i + 1).padStart(2, "0")}-${safe(o.viz)}-${safe(o.id)}.png`;
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
          // innerText skips SVG text, where Qlik draws its error message.
          txt: ((document.body.innerText || "") + " " + (document.body.textContent || "")).replace(/\s+/g, " "),
          // A broken chart still paints its legend, so node count alone lies.
          errorEl: document.querySelectorAll('[class*="error" i]:not([class*="no-error" i])').length,
        }));
        const ERRORS = /cannot be displayed|Invalid visualization|Incomplete visualization|not found on the server/i;
        // getByText(RegExp) pierces shadow roots; a "text=" regex-source selector never hits.
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
