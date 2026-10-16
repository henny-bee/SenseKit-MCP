#!/usr/bin/env node
// Timed validation of the ops-demo RUNBOOK: runs Beat 1 (reload forensics)
// and Beat 2 (security-rule drift) as an agent would, asserts every claim the
// runbook makes, and prints a transcript usable as the demo script.
//
// Leaves the site exactly as it found it: the planted rule is removed at the
// end, and the failing nightly task is standing state by design.
//
// Requires: `node setup.mjs` once, server env vars, QSEOW_ALLOW_MUTATIONS=true.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TASK_NAME, RULE_NAME, MISSING_FILE } from "./common.mjs";

const t0 = Date.now();
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;
const transport = new StdioClientTransport({
  command: "node", args: ["../../dist/index.js"], env: { ...process.env }, stderr: "ignore",
});
const client = new Client({ name: "ops-trace", version: "0.0.1" });
await client.connect(transport);
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${r.content?.[0]?.text}`);
  const raw = r.content[0].text;
  try { return JSON.parse(raw); } catch { return raw; }
};
const ok = (label, cond, detail = "") => {
  console.log(`${stamp()} ${cond ? "✓" : "✗"} ${label}${detail ? ": " + detail : ""}`);
  if (!cond) { console.error("   ASSERTION FAILED"); process.exit(1); }
};

// ── Beat 1: "The nightly sales reload failed again. Why?" ────────────────────
console.log(`${stamp()} BEAT 1 — reload forensics`);

const tasks = await call("list_tasks", { filter: `name eq '${TASK_NAME}'` });
ok("the failing task is discoverable", tasks.total === 1, TASK_NAME);
const task = tasks.items[0];
ok("last run reported FinishedFail", task.lastStatus === "FinishedFail", task.lastStatus);

const log = await call("get_reload_log", { taskId: task.id, tailLines: 60 });
ok("execution detail timeline returned", Array.isArray(log.details) && log.details.length > 0,
  `${log.details.length} entries`);
ok("script log retrieved", log.log && log.log.lines.length > 0,
  `${log.log.lines.length} of ${log.log.totalLines} lines`);

// The whole point of the tool: the ACTUAL cause, not just "it failed".
const logText = log.log.lines.join("\n");
const errLine = log.log.lines.find((l) => /Error:/i.test(l)) ?? "";
ok("root cause present in the log tail", /cannot open file/i.test(logText),
  errLine.trim().slice(0, 120));
ok("the missing file is named", logText.includes(MISSING_FILE.split("/").pop()),
  MISSING_FILE.split("/").pop());
ok("the native path is named", /Native Path:/i.test(logText),
  (/Native Path: ([^\s)]+)/i.exec(logText) || [])[1] ?? "");
console.log(`${stamp()}   → an agent can answer "why did it fail" from ONE tool call`);

// ── Engine health: "is the engine even the problem?" ─────────────────────────
const health = await call("engine_healthcheck");
ok("engine health readable", typeof health.saturated === "boolean",
  `version=${health.version} saturated=${health.saturated} loadedDocs=${health.apps.loadedDocs}`);
ok("engine is NOT the cause here", health.saturated === false, "rules out resource exhaustion");

// ── Beat 2: security-rule drift, measured as a before/after delta ────────────
console.log(`${stamp()} BEAT 2 — security-rule audit`);

const before = await call("security_rule_audit", { includeRules: false });
ok("baseline audit runs", before.totalRules > 0,
  `${before.totalRules} rules (${before.shippedRules} shipped / ${before.customRules} custom), ${before.findings.length} findings`);
const plantedBefore = before.findings.some((f) => f.ruleName === RULE_NAME);
ok("planted rule not present at baseline", !plantedBefore);
ok("shipped wildcard rules are NOT false-flagged",
  !before.findings.some((f) => ["RootAdmin", "OwnerRead", "ServiceAccount"].includes(f.ruleName)),
  "RootAdmin et al. are type ReadOnly, correctly ignored");

console.log(`${stamp()}   planting a risky custom rule...`);
const { execFileSync } = await import("node:child_process");
execFileSync("node", ["plant.mjs"], { stdio: "ignore" });

const after = await call("security_rule_audit", { includeRules: false });
const finding = after.findings.find((f) => f.ruleName === RULE_NAME);
ok("audit flags the planted rule", Boolean(finding), finding?.reason);
ok("flagged at high severity", finding?.severity === "high");
ok("custom-rule count moved by exactly one", after.customRules === before.customRules + 1,
  `${before.customRules} → ${after.customRules}`);

console.log(`${stamp()}   removing the planted rule...`);
execFileSync("node", ["reset.mjs"], { stdio: "ignore" });
const cleaned = await call("security_rule_audit", { includeRules: false });
ok("site returns to baseline", cleaned.customRules === before.customRules && !cleaned.findings.some((f) => f.ruleName === RULE_NAME),
  `${cleaned.findings.length} findings`);

console.log(`\n${stamp()} OPS TRACE COMPLETE — all assertions passed`);
console.log("note: the failing nightly task is left in place (it IS the demo state); planted rule removed.");
await client.close();
process.exit(0);
