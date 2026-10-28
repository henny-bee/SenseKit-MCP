#!/usr/bin/env node
// Run after plant.mjs; needs QSEOW_ALLOW_MUTATIONS=true.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DASHBOARD_SCRIPT_CLEAN, MEASURE_TITLE, TRUTH, PLANTED } from "./common.mjs";

const t0 = Date.now();
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;
const transport = new StdioClientTransport({
  command: "node", args: ["../../dist/index.js"], env: { ...process.env }, stderr: "ignore",
});
const client = new Client({ name: "trace", version: "0.0.1" });
await client.connect(transport);
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${r.content?.[0]?.text}`);
  const raw = r.content[0].text;
  try { return JSON.parse(raw); } catch { return raw; } // get_script returns plain text
};
const expect = (label, got, want) => {
  const ok = Math.abs(Number(got) - Number(want)) < 0.005;
  console.log(`${stamp()} ${ok ? "✓" : "✗"} ${label}: ${got}`);
  if (!ok) { console.error(`   EXPECTED ${want}`); process.exit(1); }
};

console.log(`${stamp()} STEP 1 — find the apps`);
const apps = await call("list_apps", { filter: "name sw 'AT Finance Close'" });
const dash = apps.items.find((a) => a.name.includes("Dashboard"));
const mart = apps.items.find((a) => a.name.includes("Datamart"));
console.log(`${stamp()}   dashboard=${dash.id}  datamart=${mart.id}`);

console.log(`${stamp()} STEP 2 — governed KPI on the dashboard`);
const mm = await call("evaluate_master_measure", { appId: dash.id, title: MEASURE_TITLE });
expect("dashboard KPI (planted)", mm.value, PLANTED);
console.log(`${stamp()}   governed expression: ${mm.expression}`);

console.log(`${stamp()} STEP 3 — same expression on the datamart`);
const dm = await call("evaluate_expression", { appId: mart.id, expression: mm.expression });
expect("datamart truth", dm.value, TRUTH);
console.log(`${stamp()}   mismatch confirmed: identical definition, different data`);

console.log(`${stamp()} STEP 4 — isolate by DocType on both apps`);
const cubeD = await call("create_hypercube", { appId: dash.id, dimensions: ["DocType"], measures: ["Sum(Amount)"] });
const cubeM = await call("create_hypercube", { appId: mart.id, dimensions: ["DocType"], measures: ["Sum(Amount)"] });
console.log(`${stamp()}   dashboard: ${JSON.stringify(cubeD.rows)}`);
console.log(`${stamp()}   datamart:  ${JSON.stringify(cubeM.rows)}`);
const adjD = cubeD.rows.find((r) => r[0] === "Adjustment")[1];
const adjM = cubeM.rows.find((r) => r[0] === "Adjustment")[1];
expect("delta isolated to Adjustment slice", adjD - adjM, 50000000);

console.log(`${stamp()} STEP 5 — where does this KPI live?`);
const search = await call("search_expressions", { appId: dash.id, term: "Revenue" });
const objHit = search.matches.find((m) => m.kind === "object" && m.sheetTitle);
const mmHit = search.matches.find((m) => m.kind === "master_measure");
console.log(`${stamp()}   KPI object ${objHit.objectId} on sheet "${objHit.sheetTitle}"; master measure "${mmHit.title}"`);

console.log(`${stamp()} STEP 6 — lineage (the app -> source hop)`);
const lineage = await call("get_app_lineage", { appId: dash.id });
// Engine de-dupes lineage sources; the double-load only shows in the script.
const qvdSources = lineage.filter((l) => l.kind === "qvd");
console.log(`${stamp()}   sources: ${lineage.map((l) => l.kind).join(",")} — single certified QVD, no side feeds`);
if (qvdSources.length < 1) { console.error("expected the QVD in lineage"); process.exit(1); }

console.log(`${stamp()} STEP 7 — the script`);
const script = await call("get_script", { appId: dash.id });
const planted = String(script).includes("late adjustment batch");
console.log(`${stamp()}   ${planted ? "✓" : "✗"} found the planted block: CONCATENATE re-load of DocType='Adjustment'`);
if (!planted) process.exit(1);
console.log(`${stamp()}   ROOT CAUSE: the adjustment batch is loaded twice.`);

console.log(`${stamp()} STEP 8 — fix live and tie out`);
await call("set_script", { appId: dash.id, script: DASHBOARD_SCRIPT_CLEAN });
const rel = await call("reload_app", { appId: dash.id });
if (!rel.reloadSuccess) { console.error("reload failed"); process.exit(1); }
const fixed = await call("evaluate_master_measure", { appId: dash.id, title: MEASURE_TITLE });
expect("dashboard KPI after fix", fixed.value, TRUTH);

console.log(`${stamp()} TIE-OUT COMPLETE — total tool-call time ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log("note: box is now in the CLEAN state; run plant.mjs to re-arm the demo");
await client.close();
process.exit(0);
