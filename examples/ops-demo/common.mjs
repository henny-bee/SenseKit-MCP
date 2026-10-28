import { loadConfig } from "../../dist/config.js";
import { EngineClient } from "../../dist/clients/engine.js";
import { QrsClient } from "../../dist/clients/qrs.js";

export const APP_NAME = "Ops Demo — Nightly Sales";
export const TASK_NAME = "Ops Demo Nightly Reload";
export const RULE_NAME = "Contractor Full Access (demo)";
export const CONNECTION_NAME = "FinanceCloseData"; // created by finance-close-demo/setup.mjs
export const MISSING_FILE = `lib://${CONNECTION_NAME}/nightly_sales_extract.csv`;

export const NIGHTLY_SCRIPT = `
// Nightly sales load. Expects the overnight extract dropped by the EDW job.
SET vExtract = '${MISSING_FILE}';

Sales:
LOAD
  OrderId,
  Region,
  Product,
  Num#(Amount, '#.##') AS Amount
FROM [$(vExtract)]
(txt, utf8, embedded labels, delimiter is ',');
`;

// Safe to plant: the "Contractors" group has no members, so it grants nothing.
export const RISKY_RULE = {
  name: RULE_NAME,
  category: "Security",
  type: "Custom",
  rule: `((user.group="Contractors"))`,
  resourceFilter: "*",
  actions: 2, // Read
  disabled: false,
  ruleContext: 0,
  comment: "Demo plant: wildcard resource filter — security_rule_audit should flag this.",
  tags: [],
};

export function clients() {
  const cfg = loadConfig(); // certificate mode expected for setup scripts
  return { cfg, engine: new EngineClient(cfg), qrs: new QrsClient(cfg) };
}

export async function findAppByName(qrs, name) {
  const apps = await qrs.get(`/qrs/app/full?filter=${encodeURIComponent(`name eq '${name}'`)}`);
  return apps[0]?.id;
}

export async function findTaskByName(qrs, name) {
  const tasks = await qrs.get(`/qrs/reloadtask/full?filter=${encodeURIComponent(`name eq '${name}'`)}`);
  return tasks[0]?.id;
}

export async function findRuleByName(qrs, name) {
  const rules = await qrs.get(`/qrs/systemrule/full?filter=${encodeURIComponent(`name eq '${name}'`)}`);
  return rules[0]?.id;
}
