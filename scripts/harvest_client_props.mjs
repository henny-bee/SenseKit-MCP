#!/usr/bin/env node
// Client-authored props are the only ground truth: the engine doesn't enforce them.
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
    } catch {}
  }
}
console.log(`\n${hits.length} object(s) found.`);
if (outFile && hits.length) { writeFileSync(outFile, JSON.stringify(hits, null, 2)); console.log(`written: ${outFile}`); }
await engine.close();
process.exit(0);
