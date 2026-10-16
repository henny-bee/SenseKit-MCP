# Ops-layer demo (Tier 2 tools)

> ⚠ **Runs against a live Qlik site and creates real objects** — an app, a permanently-failing reload task, and (via `plant.mjs`) a real **custom security rule**. Point it at a sandbox or the demo box, **never production.** `reset.mjs` removes the planted rule.

Three short beats showing an agent doing site operations, not just analytics.
Prereq: `node examples/ops-demo/setup.mjs` once (idempotent). It builds an app
whose nightly extract file never lands and a reload task that therefore always
ends **FinishedFail** — a permanently failing nightly job *is* the demo state.

## Beat 1 — "The nightly sales reload failed again. Why?"

1. `list_tasks {filter: "name so 'Nightly'"}` → `Ops Demo Nightly Reload`,
   lastStatus `FinishedFail`.
2. `get_reload_log {taskId}` → one call returns:
   - the scheduler's detail timeline (`Triggered → Started → FinishedFail`,
     "Reload failed in Engine", "Max retries reached"), and
   - the script-log tail with the actual cause:
     `Error: Cannot open file: 'lib://FinanceCloseData/nightly_sales_extract.csv'
     (Native Path: C:\qlik\nightly_sales_extract.csv)`.
3. Narration: the agent names the missing file, its native path, and the exact
   failing script line — no QMC, no RDP to the server, no log spelunking.
4. Optional fix-forward: drop the file (or `set_script` to point at an existing
   extract), `start_task`, watch it go `FinishedSuccess`.

## Beat 2 — "Are we compliant with our security-rule baseline?"

1. `security_rule_audit` on the clean site → counts (shipped vs custom), zero
   findings. Shipped wildcard rules like `RootAdmin` are correctly NOT flagged
   (`type: ReadOnly`/`Default` = Qlik-shipped).
2. `node examples/ops-demo/plant.mjs` — plants **"Contractor Full Access
   (demo)"**: a custom rule with `resourceFilter: "*"`. (Its condition names a
   group with no members, so it grants nothing real.)
3. `security_rule_audit` again → a `high` finding appears, naming the rule and
   the reason. The delta between the two calls is the demo.
4. `node examples/ops-demo/reset.mjs` to clean up.

## Beat 3 — "Who is on the box right now? Kick them."

Interactive, needs a second participant (or a browser tab):
1. Log into the hub in a browser (any virtual proxy).
2. `list_user_sessions {directory, userId, virtualProxy}` → the live session
   appears with its session id.
3. `end_user_sessions {directory, userId, virtualProxy}` (mutation-gated) →
   the browser tab dies on its next request. `list_user_sessions` → 0.

Note: QPS session tools are certificate-backed (the Proxy Service REST API is
certificate-only); they register in either auth mode when cert material is
configured.

## Side dish — `engine_healthcheck`

Run any time: engine version, `saturated` flag, memory, active/loaded docs,
session counts. Good opener ("is the engine even the problem?") before Beat 1.
