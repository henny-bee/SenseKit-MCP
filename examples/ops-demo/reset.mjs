#!/usr/bin/env node
// The failing nightly app/task stay: they are the demo state.
import { clients, RULE_NAME, findRuleByName } from "./common.mjs";

const { qrs, engine } = clients();
const id = await findRuleByName(qrs, RULE_NAME);
if (!id) {
  console.log("[ops-demo] no planted rule found — already clean");
} else {
  await qrs.delete(`/qrs/systemrule/${id}`);
  console.log(`[ops-demo] removed planted rule ${id}`);
}
await engine.close();
