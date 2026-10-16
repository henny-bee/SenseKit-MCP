#!/usr/bin/env node
// Ask the CLIENT what a chart's properties should be, instead of guessing.
//
// Modern Sense visualizations are nebula.js supernovas with property
// contracts the engine does not enforce: a chart can save cleanly and render
// an error. Reconstructing those contracts from error messages works only
// while the chart bothers to throw one — treemap and gauge do not.
//
// This scans every app the identity can open for objects of a given type that
// were authored BY THE SENSE CLIENT, and dumps their properties. That output
// is ground truth: mirror it and the chart renders. It is how treemap was
// fixed (the answer was qMode "K" plus a much leaner property set than the
// generic builder was producing) — after two failed rounds of guesswork.
//
// Qlik's own shipped monitoring apps (Content/Operations/License Monitor) are
// a good hunting ground: their charts were authored in the client.
//
// Usage: node scripts/harvest_client_props.mjs <qType> [outFile]
//   e.g. node scripts/harvest_client_props.mjs gauge ./gauge-truth.json
// Env: same as the server (certificate mode recommended — internal identities
// can read published apps' objects).
import { loadConfig } from "../dist/config.js";
import { EngineClient } from "../dist/clients/engine.js";
import { QrsClient } from "../dist/clients/qrs.js";
import { writeFileSync } from "node:fs";

const wanted = process.argv[2];
const outFile = process.argv[3];
if (!wanted) { console.error("usage: harvest_client_props.mjs <qType> [outFile]"); process.exit(2); }

const cfg = loadConfig();
const qrs = new QrsClient(cfg);
const engine = new EngineClient(cfg);
const apps = await qrs.get("/qrs/app/full");
const hits = [];
for (const a of apps) {
  let app;
  try { app = await engine.app(a.id); } catch { continue; }
  let infos = [];
  try { infos = await app.getAllInfos(); } catch { continue; }
  for (const info of infos.filter((i) => i.qType === wanted)) {
    try {
      const props = await (await app.getObject(info.qId)).getProperties();
      hits.push({ app: a.name, appId: a.id, objectId: info.qId, props });
      console.log(`found ${wanted} in "${a.name}" (${info.qId})`);
    } catch { /* unreadable */ }
  }
}
console.log(`\n${hits.length} object(s) found.`);
if (outFile && hits.length) { writeFileSync(outFile, JSON.stringify(hits, null, 2)); console.log(`written: ${outFile}`); }
await engine.close();
process.exit(0);
