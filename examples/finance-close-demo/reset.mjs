#!/usr/bin/env node
import {
  clients, findAppByName, setScriptAndReload,
  DASHBOARD_NAME, DASHBOARD_SCRIPT_CLEAN, TRUTH,
} from "./common.mjs";

const { engine, qrs } = clients();
const dashboardId = await findAppByName(qrs, DASHBOARD_NAME);
if (!dashboardId) throw new Error("dashboard app missing — run setup.mjs first");
const dash = await setScriptAndReload(engine, dashboardId, DASHBOARD_SCRIPT_CLEAN);
const val = await dash.evaluateEx("Sum({<Scenario={'Actual'}, Period={'FY2026-Q1'}>} Amount)");
console.log(`dashboard KPI now = ${val.qNumber} (truth ${TRUTH})`);
console.log(Math.abs(val.qNumber - Number(TRUTH)) < 0.005 ? "RESET — tied out" : "UNEXPECTED VALUE");
await engine.close();
process.exit(0);
