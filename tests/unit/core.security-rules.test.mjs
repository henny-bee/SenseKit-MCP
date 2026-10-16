import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeRuleActions, lintSecurityRules } from "../../dist/core/security-rules.js";

// ── decodeRuleActions / lintSecurityRules ────────────────────────────────────

test("decodeRuleActions decodes composite masks", () => {
  assert.deepEqual(decodeRuleActions(2), ["Read"]);
  assert.deepEqual(decodeRuleActions(1 + 2 + 4 + 8), ["Create", "Read", "Update", "Delete"]);
  assert.deepEqual(decodeRuleActions(64 | 128), ["Change owner", "Change role"]);
  assert.deepEqual(decodeRuleActions(0), ["unknown(0)"]);
});

test("lintSecurityRules flags the risky shapes and only those", () => {
  const rules = [
    { id: "r0", name: "RootAdmin", type: "ReadOnly", disabled: false, resourceFilter: "*", actions: 4294967295, rule: "((user.roles=\"RootAdmin\"))" },
    { id: "r1", name: "Owner", type: "Default", disabled: false, resourceFilter: "*", actions: 2, rule: "((Resource.owner = user))" },
    { id: "r2", name: "DisabledDefault", type: "Default", disabled: true, resourceFilter: "App*", actions: 2, rule: "x" },
    { id: "r3", name: "WildcardCustom", type: "Custom", disabled: false, resourceFilter: "*", actions: 2, rule: "user.name = \"x\"" },
    { id: "r4", name: "GodRule", type: "Custom", disabled: false, resourceFilter: "App_*", actions: 4 | 8, rule: "true" },
    { id: "r5", name: "DeadCustom", type: "Custom", disabled: true, resourceFilter: "App_*", actions: 2, rule: "x" },
    { id: "r6", name: "FineCustom", type: "Custom", disabled: false, resourceFilter: "Stream_*", actions: 2, rule: "user.group = \"BI\"" },
  ];
  const f = lintSecurityRules(rules);
  const byRule = Object.fromEntries(f.map((x) => [x.ruleId, x]));
  assert.equal(f.length, 4);
  assert.equal(byRule.r2.severity, "warn");   // disabled default
  assert.equal(byRule.r3.severity, "high");   // wildcard custom
  assert.equal(byRule.r4.severity, "high");   // unconditional write grant
  assert.equal(byRule.r5.severity, "info");   // dead custom
  assert.ok(!byRule.r0 && !byRule.r1 && !byRule.r6); // shipped ReadOnly/Default wildcards + scoped custom are fine
});
