#!/usr/bin/env node
// Visualization matrix: build ONE of every supported visualization type
// through the MCP server itself (add_sheet_object), run the validation gate
// on each, and print a render-readiness report. Also probes the negative
// paths the gate must catch. Leaves the app "MCP Viz Matrix" on the site so a
// human can eyeball actual pixels in the hub — the last mile no engine-side
// check can prove.
//
// Env: same as the server; requires QSEOW_ALLOW_MUTATIONS=true.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const APP_NAME = "MCP Viz Matrix";
const SCRIPT = `
Sales:
LOAD * INLINE [
Region,Product,Month,Sales,Qty
East,Widget,Jan,120,10
East,Gadget,Jan,90,8
West,Widget,Jan,150,12
West,Gadget,Jan,70,6
East,Widget,Feb,130,11
East,Gadget,Feb,110,9
West,Widget,Feb,160,13
West,Gadget,Feb,95,7
];
`;

// One spec per supported type: [viz, dims, measures]
const MATRIX = [
  ["kpi", [], ["Sum(Sales)"]],
  ["gauge", [], ["Sum(Sales)/2000"]],
  ["barchart", ["Region"], ["Sum(Sales)"]],
  ["linechart", ["Month"], ["Sum(Sales)"]],
  ["combochart", ["Region"], ["Sum(Sales)", "Sum(Qty)"]],
  ["piechart", ["Region"], ["Sum(Sales)"]],
  ["scatterplot", ["Product"], ["Sum(Sales)", "Sum(Qty)"]],
  ["treemap", ["Region", "Product"], ["Sum(Sales)"]],
  ["table", ["Region", "Product"], ["Sum(Sales)", "Sum(Qty)"]],
  ["pivot-table", ["Region"], ["Sum(Sales)"]],
  ["listbox", ["Region"], []],
  ["text-image", [], []],   // authored text only — measures are refused by design
];

const transport = new StdioClientTransport({
  command: "node", args: ["dist/index.js"], env: { ...process.env }, stderr: "inherit",
});
const client = new Client({ name: "viz-matrix", version: "0.0.1" });
await client.connect(transport);
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content?.[0]?.text ?? "";
  if (r.isError) throw new Error(`${name}: ${t}`);
  return JSON.parse(t.startsWith("{") || t.startsWith("[") ? t : JSON.stringify(t));
};

// Fresh app each run.
const existing = await call("list_apps", { filter: `name eq '${APP_NAME}'` });
if (existing.total > 0) await call("delete_app", { appId: existing.items[0].id });
const app = await call("create_app", { name: APP_NAME, script: SCRIPT, reload: true });
const appId = app.appId;
console.log(`app ${appId} reloaded=${app.reloaded}`);
const sheet = await call("create_sheet", { appId, title: "Matrix", description: "one of every type" });
const sheetId = sheet.sheetId;

// ---- build the matrix through the MCP tool, gate validates on creation
const rows = [];
for (const [viz, dims, meas] of MATRIX) {
  try {
    const r = await call("add_sheet_object", {
      appId, sheetId, visualization: viz, title: `${viz} sample`,
      dimensions: dims, measures: meas,
    });
    rows.push({ viz, status: r.validation.status, findings: r.validation.findings.map((f) => f.message) });
  } catch (e) {
    rows.push({ viz, status: "CREATE-REFUSED", findings: [String(e.message).slice(0, 160)] });
  }
}

// ---- negative probes: the gate must catch each of these
const negatives = [];
// 1. unknown field in a dimension -> refused BEFORE creating
try {
  await call("add_sheet_object", { appId, sheetId, visualization: "barchart", dimensions: ["Regoin"], measures: ["Sum(Sales)"] });
  negatives.push({ probe: "bad dimension field", result: "NOT CAUGHT (object created)" });
} catch (e) {
  negatives.push({ probe: "bad dimension field", result: /not in the data model/.test(e.message) ? "refused pre-create ✔" : `unexpected: ${e.message.slice(0, 120)}` });
}
// 2. bad measure field -> created, but the gate must FAIL it
try {
  const r = await call("add_sheet_object", { appId, sheetId, visualization: "kpi", title: "bad measure", measures: ["Sum(Salse)"] });
  negatives.push({ probe: "bad measure field", result: r.validation.status === "fail" ? "gate FAILs it ✔" : `gate said ${r.validation.status} — should fail` });
} catch (e) {
  negatives.push({ probe: "bad measure field", result: `create threw: ${e.message.slice(0, 120)}` });
}
// 3. wrong shape -> refused
try {
  await call("add_sheet_object", { appId, sheetId, visualization: "piechart", dimensions: ["Region", "Product"], measures: ["Sum(Sales)"] });
  negatives.push({ probe: "shape violation (pie w/ 2 dims)", result: "NOT CAUGHT" });
} catch (e) {
  negatives.push({ probe: "shape violation (pie w/ 2 dims)", result: /refusing to create/.test(e.message) ? "refused pre-create ✔" : `unexpected: ${e.message.slice(0, 120)}` });
}
// 4. unknown visualization type -> gate warns/fails
try {
  const r = await call("add_sheet_object", { appId, sheetId, visualization: "hologram-chart", measures: ["Sum(Sales)"], dimensions: [] });
  negatives.push({ probe: "unknown viz type", result: r.validation.status !== "pass" ? `gate says ${r.validation.status} ✔` : "gate passed it — should not" });
} catch (e) {
  negatives.push({ probe: "unknown viz type", result: `create threw: ${e.message.slice(0, 120)}` });
}

// ---- whole-sheet validation (placement lint over everything built above)
const sheetReport = await call("validate_sheet", { appId, sheetId });

console.log("\n=== VIZ MATRIX ===");
for (const r of rows) console.log(`${r.status.toUpperCase().padEnd(14)} ${r.viz}${r.findings.length ? " — " + r.findings.join("; ") : ""}`);
console.log("\n=== NEGATIVE PROBES ===");
for (const n of negatives) console.log(`${n.probe}: ${n.result}`);
console.log("\n=== SHEET VERDICT ===");
console.log(`verdict=${sheetReport.verdict} objects=${sheetReport.objectCount} placementFindings=${sheetReport.placementFindings.length}`);
console.log(`\napp left on site for hub eyeballing: ${APP_NAME} (${appId})`);

await client.close();
const bad = rows.filter((r) => r.status === "fail" || r.status === "CREATE-REFUSED").length;
process.exit(bad === 0 ? 0 : 1);
