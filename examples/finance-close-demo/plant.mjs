#!/usr/bin/env node
// Plant the defect: swap the dashboard's script for the version that
// double-loads the adjustment batch, and reload. Dashboard KPI inflates
// to $655,728,164.79 while the datamart truth stays $605,728,164.79.
import {
  clients, findAppByName, setScriptAndReload,
  DASHBOARD_NAME, DASHBOARD_SCRIPT_PLANTED, PLANTED,
} from "./common.mjs";

const { engine, qrs } = clients();
const dashboardId = await findAppByName(qrs, DASHBOARD_NAME);
if (!dashboardId) throw new Error("dashboard app missing — run setup.mjs first");
const dash = await setScriptAndReload(engine, dashboardId, DASHBOARD_SCRIPT_PLANTED);
const val = await dash.evaluateEx("Sum({<Scenario={'Actual'}, Period={'FY2026-Q1'}>} Amount)");
console.log(`dashboard KPI now = ${val.qNumber} (planted target ${PLANTED})`);
const armed = Math.abs(val.qNumber - Number(PLANTED)) < 0.005;
console.log(armed ? "PLANTED — mismatch live" : "UNEXPECTED VALUE — demo NOT armed");
await engine.close();
// Non-zero exit on a wrong value so a pre-flight script (or a human skimming
// output) can't mistake a failed plant for an armed demo.
process.exit(armed ? 0 : 1);
