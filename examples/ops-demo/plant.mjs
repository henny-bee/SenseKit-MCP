#!/usr/bin/env node
// Plant the risky custom security rule for the security_rule_audit beat.
// Idempotent. Undo with reset.mjs.
import { clients, RISKY_RULE, RULE_NAME, findRuleByName } from "./common.mjs";

const { qrs, engine } = clients();
const existing = await findRuleByName(qrs, RULE_NAME);
if (existing) {
  console.log(`[ops-demo] rule already planted (${existing})`);
} else {
  const r = await qrs.post("/qrs/systemrule", RISKY_RULE);
  console.log(`[ops-demo] planted rule ${r.id} — security_rule_audit should now flag "${RULE_NAME}"`);
}
await engine.close();
