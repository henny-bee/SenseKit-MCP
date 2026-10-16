// QRS systemrule `actions` bitmask, per the QMC security-rule editor.
const RULE_ACTIONS: Array<[number, string]> = [
  [1, "Create"], [2, "Read"], [4, "Update"], [8, "Delete"], [16, "Export"],
  [32, "Publish"], [64, "Change owner"], [128, "Change role"], [256, "Export data"],
  [512, "Offline access"], [1024, "Distribute"], [2048, "Duplicate"], [4096, "Approve"],
];

export function decodeRuleActions(mask: number): string[] {
  const out = RULE_ACTIONS.filter(([bit]) => (mask & bit) !== 0).map(([, name]) => name);
  return out.length ? out : [`unknown(${mask})`];
}

export interface SecurityRuleFinding {
  severity: "high" | "warn" | "info";
  ruleId: string;
  ruleName: string;
  reason: string;
}

/** Shipped rules carry type "Default" (editable) or "ReadOnly" (immutable,
 *  e.g. RootAdmin) — verified live; only "Custom" is user-authored. */
export function isShippedRule(type: unknown): boolean {
  return type === "Default" || type === "ReadOnly";
}

/** Heuristic lint over QRS security rules. Findings are prompts for a human
 *  review, not verdicts — a disabled default rule can be a deliberate
 *  hardening choice. */
/** The QRS systemrule fields the lint reads (the entity carries many more). */
export interface SecurityRule {
  id?: string;
  name?: string;
  type?: unknown;
  disabled?: boolean;
  resourceFilter?: string;
  actions?: unknown;
  rule?: string;
  [key: string]: unknown;
}

export function lintSecurityRules(rules: SecurityRule[]): SecurityRuleFinding[] {
  const findings: SecurityRuleFinding[] = [];
  const WRITE_MASK = 4 | 8 | 64 | 128; // Update, Delete, Change owner, Change role
  for (const r of rules) {
    const isDefault = isShippedRule(r.type);
    const id = r.id ?? "?";
    const name = r.name ?? "?";
    const condition = String(r.rule ?? "").trim();
    const filter = String(r.resourceFilter ?? "").trim();
    if (isDefault && r.disabled) {
      findings.push({ severity: "warn", ruleId: id, ruleName: name,
        reason: "Default rule is disabled — the site deviates from the shipped security baseline" });
    }
    if (!isDefault && !r.disabled) {
      if (filter === "*") {
        findings.push({ severity: "high", ruleId: id, ruleName: name,
          reason: "Custom rule applies to ALL resource types (resourceFilter '*')" });
      }
      const unconditional = condition === "" || /^\(*\s*true\s*\)*$/i.test(condition);
      if (unconditional && (Number(r.actions) & WRITE_MASK) !== 0) {
        findings.push({ severity: "high", ruleId: id, ruleName: name,
          reason: `Unconditional custom rule grants write-level actions (${decodeRuleActions(Number(r.actions)).join(", ")})` });
      }
    }
    if (!isDefault && r.disabled) {
      findings.push({ severity: "info", ruleId: id, ruleName: name,
        reason: "Disabled custom rule — dead configuration worth pruning" });
    }
  }
  return findings;
}
