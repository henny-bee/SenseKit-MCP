#!/usr/bin/env node
// Needs QSEOW_ALLOW_MUTATIONS=true; recreates the app each run.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { APP_NAME, SHEET_TITLE, SCRIPT, PANELS, TOTAL_SALES } from "./common.mjs";

const t0 = Date.now();
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;
const transport = new StdioClientTransport({
  command: "node", args: ["../../dist/index.js"], env: { ...process.env }, stderr: "ignore",
});
const client = new Client({ name: "builder-trace", version: "0.0.1" });
await client.connect(transport);
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${r.content?.[0]?.text}`);
  const raw = r.content[0].text;
  try { return JSON.parse(raw); } catch { return raw; }
};
const refuses = async (label, name, args, pattern) => {
  try {
    await call(name, args);
    console.error(`${stamp()} ✗ ${label}: NOT refused`);
    process.exit(1);
  } catch (e) {
    const hit = pattern.test(e.message);
    console.log(`${stamp()} ${hit ? "✓" : "✗"} ${label}: ${e.message.split("\n")[0].slice(0, 110)}`);
    if (!hit) process.exit(1);
  }
};
const ok = (label, cond, detail = "") => {
  console.log(`${stamp()} ${cond ? "✓" : "✗"} ${label}${detail ? ": " + detail : ""}`);
  if (!cond) { console.error("   ASSERTION FAILED"); process.exit(1); }
};

console.log(`${stamp()} STEP 1 — create the app and load data`);
const existing = await call("list_apps", { filter: `name eq '${APP_NAME}'` });
if (existing.total > 0) await call("delete_app", { appId: existing.items[0].id });
const app = await call("create_app", { name: APP_NAME, script: SCRIPT, reload: true });
ok("app created and reloaded", app.reloaded === true, app.appId);

console.log(`${stamp()} STEP 2 — build "${SHEET_TITLE}" (4 visualizations)`);
const sheet = await call("create_sheet", { appId: app.appId, title: SHEET_TITLE });
for (const p of PANELS) {
  const r = await call("add_sheet_object", { appId: app.appId, sheetId: sheet.sheetId, ...p });
  ok(`${p.visualization.padEnd(10)} "${p.title}"`, r.validation.status === "pass",
    `gate=${r.validation.status}`);
}

console.log(`${stamp()} STEP 3 — the gate refuses what an API wrapper would happily save`);
await refuses("misspelled dimension field is refused pre-create", "add_sheet_object",
  { appId: app.appId, sheetId: sheet.sheetId, visualization: "barchart", dimensions: ["Regoin"], measures: ["Sum(Sales)"] },
  /not in the data model/i);
await refuses("impossible chart shape is refused pre-create", "add_sheet_object",
  { appId: app.appId, sheetId: sheet.sheetId, visualization: "piechart", dimensions: ["Region", "Product"], measures: ["Sum(Sales)"] },
  /refusing to create/i);

const bad = await call("add_sheet_object", {
  appId: app.appId, sheetId: sheet.sheetId, visualization: "kpi",
  title: "Bad KPI (deliberate)", measures: ["Sum(Salse)"],
});
ok("misspelled measure field is caught by the gate", bad.validation.status === "fail",
  bad.validation.findings[0]?.message.slice(0, 110));
console.log(`${stamp()}   ↑ Qlik itself would render this as 0 with no error — that is the trap`);

console.log(`${stamp()} STEP 4 — validate the whole sheet`);
const dirty = await call("validate_sheet", { appId: app.appId, sheetId: sheet.sheetId });
ok("sheet verdict is FAIL while the bad object exists", dirty.verdict === "FAIL",
  `${dirty.objectCount} objects`);

await call("delete_app", { appId: app.appId });
const rebuilt = await call("create_app", { name: APP_NAME, script: SCRIPT, reload: true });
const sheet2 = await call("create_sheet", { appId: rebuilt.appId, title: SHEET_TITLE });
for (const p of PANELS) await call("add_sheet_object", { appId: rebuilt.appId, sheetId: sheet2.sheetId, ...p });
const clean = await call("validate_sheet", { appId: rebuilt.appId, sheetId: sheet2.sheetId });
ok("clean sheet verdict is PASS", clean.verdict === "PASS", `${clean.objectCount} objects, 0 findings`);
ok("no placement problems", clean.placementFindings.length === 0);

console.log(`${stamp()} STEP 5 — the numbers carry their own context`);
const total = await call("evaluate_expression", { appId: rebuilt.appId, expression: "Sum(Sales)" });
ok("value correct", Number(total.value) === TOTAL_SALES, String(total.value));
ok("selection context attached", Array.isArray(total.activeSelections),
  `${total.activeSelections.length} active selections (unfiltered)`);

const warned = await call("evaluate_expression", { appId: rebuilt.appId, expression: "Sum(Salse)" });
ok("unknown field warned, not silently zeroed", (warned.warnings ?? []).some((w) => /unknown field/i.test(w)),
  warned.warnings?.[0]?.slice(0, 90));

const xc = await call("crosscheck_expression", { appId: rebuilt.appId, expression: "Sum(Sales)", groupBy: "Region" });
ok("additive measure cross-checks consistent", xc.consistent === true,
  `total ${xc.total} = sum of ${xc.groupCount} groups ${xc.sumOfGroups}`);
const xc2 = await call("crosscheck_expression", { appId: rebuilt.appId, expression: "Count(distinct Month)", groupBy: "Region" });
ok("non-additive measure flagged", xc2.consistent === false,
  `total ${xc2.total} vs sum-of-groups ${xc2.sumOfGroups} — sum-of-parts would mislead`);

console.log(`\n${stamp()} BUILDER TRACE COMPLETE — all assertions passed`);
console.log(`app left on the site for visual inspection: ${APP_NAME} (${rebuilt.appId})`);
await client.close();
process.exit(0);
