#!/usr/bin/env node
// Build the failed-nightly-reload scenario: app + reload task, then run the
// task once so a FinishedFail execution (with script log) exists for
// get_reload_log to dissect. Idempotent — safe to re-run.
import {
  clients, APP_NAME, TASK_NAME, NIGHTLY_SCRIPT, findAppByName, findTaskByName,
} from "./common.mjs";

const { engine, qrs } = clients();
const log = (m) => console.log(`[ops-demo] ${m}`);

let appId = await findAppByName(qrs, APP_NAME);
if (!appId) {
  const g = await engine.global();
  const created = await g.createApp(APP_NAME, "main");
  appId = created.qAppId;
  log(`created app ${appId}`);
} else {
  log(`app exists ${appId}`);
}

const app = await engine.app(appId);
await app.setScript(NIGHTLY_SCRIPT);
await app.doSave();
log("nightly script set (extract file deliberately missing)");

let taskId = await findTaskByName(qrs, TASK_NAME);
if (!taskId) {
  const task = await qrs.post("/qrs/reloadtask", {
    app: { id: appId },
    name: TASK_NAME,
    enabled: true,
    taskSessionTimeout: 1440,
    maxRetries: 0,
  });
  taskId = task.id;
  log(`created task ${taskId}`);
} else {
  log(`task exists ${taskId}`);
}

log("starting the task (expected outcome: FinishedFail)...");
await qrs.post(`/qrs/task/${taskId}/start`);
let status = "?";
for (let i = 0; i < 24; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const t = await qrs.get(`/qrs/reloadtask/${taskId}`);
  const s = t.operational?.lastExecutionResult?.status;
  if (s === 8) { status = "FinishedFail"; break; }
  if (s === 7) { status = "FinishedSuccess (UNEXPECTED — is the extract file present?)"; break; }
}
log(`task ended: ${status}`);
log(`demo ready — ask the agent: "The nightly sales reload failed again. Why?" (get_reload_log taskId=${taskId})`);
await engine.close();
