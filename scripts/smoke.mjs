#!/usr/bin/env node
// Integration smoke test: spawns the MCP server over stdio and exercises
// admin + developer + analyst tools against a live QSEoW site.
// Requires env (see .env.example) and reachable QRS/engine ports.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const APP_NAME = process.env.SMOKE_APP_NAME || "MCP Smoke Demo";
const DEMO_SCRIPT = `
Sales:
LOAD * INLINE [
Region,Product,Month,Sales
East,Widget,Jan,120
East,Gadget,Jan,90
West,Widget,Jan,150
West,Gadget,Jan,70
East,Widget,Feb,130
East,Gadget,Feb,110
West,Widget,Feb,160
West,Gadget,Feb,95
];
`;

const t0 = Date.now();
const log = (label, v) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}: ${s.length > 400 ? s.slice(0, 400) + "…" : s}`);
};

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env },
  stderr: "inherit",
});
const client = new Client({ name: "smoke", version: "0.0.1" });
await client.connect(transport);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  if (r.isError) throw new Error(`${name} failed: ${text}`);
  return text;
};

let failures = 0;
const step = async (label, fn) => {
  try {
    const v = await fn();
    log(`PASS ${label}`, v ?? "");
    return v;
  } catch (e) {
    failures++;
    log(`FAIL ${label}`, e.message);
    return undefined;
  }
};

// ---- admin
const tools = await client.listTools();
log("tools registered", tools.tools.map((t) => t.name).join(", "));

const MUTATING = ["set_script", "reload_app", "create_app", "copy_app", "publish_app", "delete_app", "start_task", "end_user_sessions", "create_sheet", "add_sheet_object"];

await step("annotations present on every tool", () => {
  const missing = tools.tools.filter((t) => typeof t.annotations?.readOnlyHint !== "boolean");
  if (missing.length) throw new Error(`no annotations: ${missing.map((t) => t.name).join(",")}`);
  const wrongRead = tools.tools.filter((t) => MUTATING.includes(t.name) && t.annotations.readOnlyHint !== false);
  if (wrongRead.length) throw new Error(`mutating tool marked read-only: ${wrongRead.map((t) => t.name).join(",")}`);
  return `${tools.tools.length} tools annotated`;
});

await step("read-only server registers no mutating tools", async () => {
  const roEnv = { ...process.env };
  delete roEnv.QSEOW_ALLOW_MUTATIONS;
  const roTransport = new StdioClientTransport({
    command: "node", args: ["dist/index.js"], env: roEnv, stderr: "ignore",
  });
  const roClient = new Client({ name: "smoke-ro", version: "0.0.1" });
  await roClient.connect(roTransport);
  try {
    const roTools = (await roClient.listTools()).tools.map((t) => t.name);
    const leaked = MUTATING.filter((m) => roTools.includes(m));
    if (leaked.length) throw new Error(`mutating tools visible read-only: ${leaked.join(",")}`);
    return `${roTools.length} tools, zero mutating`;
  } finally {
    await roClient.close();
  }
});

await step("qrs_about", () => call("qrs_about"));
await step("service_status", () => call("service_status"));
await step("license_summary", async () => {
  const r = await call("license_summary");
  return JSON.parse(r).serial;
});

await step("pagination envelope (list_apps limit=1)", async () => {
  const page = JSON.parse(await call("list_apps", { limit: 1 }));
  if (!Array.isArray(page.items) || typeof page.total !== "number" || page.returned > 1) {
    throw new Error(`bad envelope: ${JSON.stringify(page).slice(0, 200)}`);
  }
  return `total=${page.total} returned=${page.returned} truncated=${page.truncated}`;
});

await step("qrs_search dataconnection full:true redacts secrets", async () => {
  const raw = await call("qrs_search", { entity: "dataconnection", full: true });
  const leaks = raw.match(/"(password|passphrase|clientsecret)"\s*:\s*"(?!\*\*\*REDACTED\*\*\*")[^"]+"/gi) ?? [];
  const kvLeaks = raw.match(/\b(pwd|password|apikey)\s*=\s*(?!\*\*\*REDACTED\*\*\*)[^;"'\s*]+/gi) ?? [];
  if (leaks.length || kvLeaks.length) throw new Error(`unredacted: ${[...leaks, ...kvLeaks].slice(0, 3).join(" | ")}`);
  return `clean (${raw.length} chars scanned)`;
});

// ---- developer: create demo app if absent
let appId;
await step("find-or-create demo app", async () => {
  const apps = JSON.parse(await call("list_apps", { filter: `name eq '${APP_NAME}'` }));
  if (apps.items.length > 0) { appId = apps.items[0].id; return `exists ${appId}`; }
  const created = JSON.parse(await call("create_app", { name: APP_NAME, script: DEMO_SCRIPT, reload: true }));
  appId = created.appId;
  return `created ${appId} reloaded=${created.reloaded}`;
});

if (appId) {
  await step("check_script", () => call("check_script", { appId }));
  await step("get_app_data_model", async () => {
    const m = JSON.parse(await call("get_app_data_model", { appId }));
    return m.tables.map((t) => `${t.name}(${t.rows} rows)`).join(",");
  });
  await step("evaluate_expression Sum(Sales)", () => call("evaluate_expression", { appId, expression: "Sum(Sales)" }));
  await step("create_hypercube Region x Sum(Sales)", () =>
    call("create_hypercube", { appId, dimensions: ["Region"], measures: ["Sum(Sales)"] }));
  await step("select East", async () => {
    const r = JSON.parse(await call("select_field_values", { appId, field: "Region", values: ["East"] }));
    if (r.selectedCount !== 1) throw new Error(`expected selectedCount 1, got ${r.selectedCount}`);
    return `mode=${r.mode} selectedCount=${r.selectedCount}`;
  });
  await step("hypercube honors selection", async () => {
    const r = JSON.parse(await call("create_hypercube", { appId, dimensions: ["Product"], measures: ["Sum(Sales)"] }));
    return JSON.stringify(r.rows);
  });
  await step("numeric selection lands exactly (Sales=120)", async () => {
    // Regression for the silent-widening bug: text-only qText against a
    // numeric field selects nothing/widens without error. Numeric dual must
    // select exactly one value.
    await call("clear_selections", { appId });
    const r = JSON.parse(await call("select_field_values", { appId, field: "Sales", values: [120] }));
    if (r.selectedCount !== 1) throw new Error(`expected selectedCount 1, got ${r.selectedCount} (mode=${r.mode})`);
    const ev = JSON.parse(await call("evaluate_expression", { appId, expression: "Sum(Sales)" }));
    if (Number(ev.value) !== 120) throw new Error(`Sum(Sales) under selection = ${ev.value}, want 120`);
    return `mode=${r.mode} selectedCount=1 Sum=120`;
  });
  await step("numeric-looking text via string also lands", async () => {
    await call("clear_selections", { appId });
    const r = JSON.parse(await call("select_field_values", { appId, field: "Sales", values: ["150"] }));
    if (r.selectedCount !== 1) throw new Error(`expected selectedCount 1, got ${r.selectedCount} (mode=${r.mode})`);
    return `mode=${r.mode} selectedCount=1`;
  });
  await step("current selections", () => call("get_current_selections", { appId }));
  await step("clear selections", () => call("clear_selections", { appId }));
  await step("get_field_values Month", () => call("get_field_values", { appId, field: "Month" }));
}

// ---- inspector tools (Tier 1: the troubleshooting loop)
// Requires the sheet/measure fixture: node scripts/fixture_sheet.mjs <appId>
if (appId) {
  let smokeSheetId, kpiObjectId, smokeMeasureId;
  await step("list_sheets finds fixture sheet", async () => {
    const sheets = JSON.parse(await call("list_sheets", { appId }));
    const s = sheets.find((x) => x.title === "MCP Smoke Sheet");
    if (!s) throw new Error("fixture sheet missing — run scripts/fixture_sheet.mjs");
    smokeSheetId = s.sheetId;
    return smokeSheetId;
  });
  if (smokeSheetId) {
    await step("get_sheet_objects finds KPI", async () => {
      const r = JSON.parse(await call("get_sheet_objects", { appId, sheetId: smokeSheetId }));
      const kpi = r.objects.find((o) => o.qType === "kpi");
      if (!kpi) throw new Error(`no kpi child: ${JSON.stringify(r.objects)}`);
      kpiObjectId = kpi.objectId;
      return `${r.objects.length} objects, kpi=${kpiObjectId} title=${kpi.title}`;
    });
  }
  if (kpiObjectId) {
    await step("get_object_properties returns qProps w/ library ref", async () => {
      const p = JSON.parse(await call("get_object_properties", { appId, objectId: kpiObjectId }));
      const libId = p.qHyperCubeDef?.qMeasures?.[0]?.qLibraryId;
      if (!libId) throw new Error("KPI qProps missing qLibraryId");
      smokeMeasureId = libId;
      return `qLibraryId=${libId}`;
    });
  }
  await step("list_master_measures finds Smoke Revenue", async () => {
    const r = JSON.parse(await call("list_master_measures", { appId }));
    const m = r.items.find((x) => x.title === "Smoke Revenue");
    if (!m) throw new Error("Smoke Revenue master measure missing");
    if (m.expression !== "Sum(Sales)") throw new Error(`unexpected expression ${m.expression}`);
    return `${m.measureId} expr=${m.expression}`;
  });
  await step("list_master_dimensions returns envelope", async () => {
    const r = JSON.parse(await call("list_master_dimensions", { appId }));
    if (!Array.isArray(r.items)) throw new Error("bad envelope");
    return `total=${r.total}`;
  });
  await step("evaluate_master_measure by title = 925", async () => {
    await call("clear_selections", { appId });
    const r = JSON.parse(await call("evaluate_master_measure", { appId, title: "Smoke Revenue" }));
    if (Number(r.value) !== 925) throw new Error(`value=${r.value}, want 925`);
    return `expr=${r.expression} value=${r.value}`;
  });
  await step("search_expressions('Sales') spans objects+measures", async () => {
    // Script matches are NOT required here: the demo app is published, and
    // the engine hides a published app's script from user identities (JWT
    // mode). Script-layer search + lineage are asserted below on the owned
    // unpublished copy — the documented support-agent pattern.
    const r = JSON.parse(await call("search_expressions", { appId, term: "Sales" }));
    const kinds = new Set(r.matches.map((m) => m.kind));
    for (const want of ["object", "master_measure"]) {
      if (!kinds.has(want)) throw new Error(`no ${want} match: kinds=${[...kinds].join(",")}`);
    }
    const sheetAnnotated = r.matches.some((m) => m.kind === "object" && m.sheetTitle === "MCP Smoke Sheet");
    return `matches=${r.matchCount} kinds=${[...kinds].join(",")} sheetAnnotated=${sheetAnnotated} scanned=${r.objectsScanned}`;
  });
}

// ---- explicit coverage: remaining list tools (envelope shape asserted)
const envelope = (r) => {
  const p = JSON.parse(r);
  if (!Array.isArray(p.items) || typeof p.total !== "number") throw new Error(`bad envelope: ${r.slice(0, 120)}`);
  return p;
};
await step("list_streams", async () => `total=${envelope(await call("list_streams", {})).total}`);
await step("list_tasks", async () => `total=${envelope(await call("list_tasks", {})).total}`);
await step("list_users", async () => `total=${envelope(await call("list_users", {})).total}`);
await step("list_extensions", async () => `total=${envelope(await call("list_extensions", {})).total}`);
await step("list_data_connections redacts", async () => {
  const raw = await call("list_data_connections", {});
  const p = envelope(raw);
  const kvLeaks = raw.match(/\b(pwd|password|apikey)\s*=\s*(?!\*\*\*REDACTED\*\*\*)[^;"'\s*]+/gi) ?? [];
  if (kvLeaks.length) throw new Error(`unredacted: ${kvLeaks.slice(0, 2).join(" | ")}`);
  return `total=${p.total} clean`;
});
await step("list_engine_apps", async () => `total=${envelope(await call("list_engine_apps", {})).total}`);

// ---- mutation lifecycle on a disposable copy: copy -> set_script ->
// reload -> evaluate -> publish -> delete. Leaves the site as it found it.
const COPY_NAME = `MCP Smoke Copy`;
const COPY_SCRIPT = `S: LOAD * INLINE [Sales\n42\n];`;
let copyId;
await step("copy_app", async () => {
  const r = JSON.parse(await call("copy_app", { appId, name: COPY_NAME }));
  copyId = r.newAppId;
  if (!copyId) throw new Error("no newAppId");
  return copyId;
});
if (copyId) {
  await step("set_script on copy", () => call("set_script", { appId: copyId, script: COPY_SCRIPT }));
  await step("reload_app on copy", async () => {
    const r = JSON.parse(await call("reload_app", { appId: copyId }));
    if (!r.reloadSuccess) throw new Error("reload failed");
    return `reloadSuccess=${r.reloadSuccess}`;
  });
  await step("copy reflects new script (Sum(Sales)=42)", async () => {
    const ev = JSON.parse(await call("evaluate_expression", { appId: copyId, expression: "Sum(Sales)" }));
    if (Number(ev.value) !== 42) throw new Error(`Sum(Sales)=${ev.value}, want 42`);
    return "Sum=42";
  });
  await step("search_expressions on owned copy includes script", async () => {
    const r = JSON.parse(await call("search_expressions", { appId: copyId, term: "Sales" }));
    const kinds = new Set(r.matches.map((m) => m.kind));
    if (!kinds.has("script")) throw new Error(`no script match on owned copy: kinds=${[...kinds].join(",")}`);
    return `kinds=${[...kinds].join(",")}`;
  });
  await step("get_app_lineage on owned copy shows inline", async () => {
    const r = JSON.parse(await call("get_app_lineage", { appId: copyId }));
    if (!r.some((l) => l.kind === "inline")) throw new Error(`no inline lineage: ${JSON.stringify(r).slice(0, 200)}`);
    return r.map((l) => l.kind).join(",");
  });
  // ---- UI builder + validation gate (on the disposable copy: field Sales)
  let vizSheetId;
  await step("create_sheet on copy", async () => {
    const r = JSON.parse(await call("create_sheet", { appId: copyId, title: "Smoke Viz Sheet" }));
    vizSheetId = r.sheetId;
    if (!vizSheetId) throw new Error("no sheetId");
    return vizSheetId;
  });
  if (vizSheetId) {
    await step("add_sheet_object kpi passes the gate", async () => {
      const r = JSON.parse(await call("add_sheet_object", {
        appId: copyId, sheetId: vizSheetId, visualization: "kpi", title: "Sales KPI", measures: ["Sum(Sales)"],
      }));
      if (r.validation.status !== "pass") throw new Error(`gate=${r.validation.status}: ${JSON.stringify(r.validation.findings)}`);
      return `objectId=${r.objectId} gate=pass`;
    });
    await step("add_sheet_object bad measure -> gate FAILs it", async () => {
      const r = JSON.parse(await call("add_sheet_object", {
        appId: copyId, sheetId: vizSheetId, visualization: "kpi", title: "Bad KPI", measures: ["Sum(Salse)"],
      }));
      if (r.validation.status !== "fail") throw new Error(`gate=${r.validation.status}, want fail`);
      return "unknown field caught by gate";
    });
    await step("add_sheet_object shape violation -> refused pre-create", async () => {
      try {
        await call("add_sheet_object", { appId: copyId, sheetId: vizSheetId, visualization: "piechart", dimensions: ["Sales", "Sales"], measures: ["Sum(Sales)", "Sum(Sales)"] });
        throw new Error("shape violation was accepted");
      } catch (e) {
        if (!/refusing to create/.test(e.message)) throw e;
        return "refused as designed";
      }
    });
    await step("validate_sheet reports the bad object", async () => {
      const r = JSON.parse(await call("validate_sheet", { appId: copyId, sheetId: vizSheetId }));
      if (r.verdict !== "FAIL") throw new Error(`verdict=${r.verdict}, want FAIL (bad KPI present)`);
      const bad = r.objects.find((o) => o.title === "Bad KPI");
      if (!bad || bad.status !== "fail") throw new Error("bad object not failed");
      return `verdict=FAIL objects=${r.objectCount} (as expected with planted bad KPI)`;
    });
  }

  // ---- analytics trust envelope
  await step("evaluate_expression carries activeSelections", async () => {
    const r = JSON.parse(await call("evaluate_expression", { appId: copyId, expression: "Sum(Sales)" }));
    if (!Array.isArray(r.activeSelections)) throw new Error("no activeSelections");
    return `value=${r.value} selections=${r.activeSelections.length}`;
  });
  await step("evaluate_expression warns on unknown field", async () => {
    const r = JSON.parse(await call("evaluate_expression", { appId: copyId, expression: "Sum(Salse)" }));
    if (!r.warnings || !r.warnings.some((w) => /unknown field/i.test(w))) throw new Error(`no unknown-field warning: ${JSON.stringify(r)}`);
    return r.warnings[0];
  });
  await step("crosscheck_expression consistent on additive measure", async () => {
    const r = JSON.parse(await call("crosscheck_expression", { appId: copyId, expression: "Sum(Sales)", groupBy: "Sales" }));
    if (r.consistent !== true) throw new Error(`inconsistent: ${JSON.stringify(r)}`);
    return `total=${r.total} sumOfGroups=${r.sumOfGroups} consistent`;
  });
  await step("crosscheck_expression flags non-additive measure", async () => {
    // Demo app: Count(distinct Month)=2 overall, but each Region also has 2
    // -> sum of groups 4 != 2. The classic double-count a naive agent reports.
    await call("clear_selections", { appId });
    const r = JSON.parse(await call("crosscheck_expression", { appId, expression: "Count(distinct Month)", groupBy: "Region" }));
    if (r.consistent !== false) throw new Error(`expected inconsistent, got: ${JSON.stringify(r)}`);
    return `total=${r.total} sumOfGroups=${r.sumOfGroups} flagged non-additive`;
  });

  await step("get_script redacts embedded credentials", async () => {
    // Regression for the script-egress gap: scripts are a credential egress
    // path just like QRS connection strings.
    await call("set_script", { appId: copyId, script: `SET vPassword = 'hunter2';\n${COPY_SCRIPT}` });
    const script = await call("get_script", { appId: copyId });
    if (script.includes("hunter2")) throw new Error("secret leaked through get_script");
    if (!script.includes("***REDACTED***")) throw new Error("redaction marker missing");
    return "secret masked";
  });
  await step("set_script refuses the redaction marker (round-trip guard)", async () => {
    try {
      await call("set_script", { appId: copyId, script: "SET vPassword = ***REDACTED***;" });
      throw new Error("set_script accepted a redacted script");
    } catch (e) {
      if (!/redaction marker/i.test(e.message)) throw e;
      return "refused as designed";
    }
  });
  await step("GUID gate rejects non-GUID appId", async () => {
    try {
      await call("evaluate_expression", { appId: "../qrs/about", expression: "1" });
      throw new Error("non-GUID appId was accepted");
    } catch (e) {
      if (!/GUID/i.test(e.message)) throw e;
      return "rejected as designed";
    }
  });
  await step("publish_app copy to Everyone", async () => {
    const r = JSON.parse(await call("publish_app", { appId: copyId, streamName: "Everyone" }));
    if (!r.published) throw new Error("not published");
    return `stream=${r.stream}`;
  });
  await step("delete_app copy (cleanup)", async () => {
    await call("delete_app", { appId: copyId });
    const gone = JSON.parse(await call("list_apps", { filter: `id eq ${copyId}` }));
    if (gone.total !== 0) throw new Error("copy still present after delete");
    return "deleted + verified gone";
  });
}

// ---- start_task: needs the persistent fixture task (bound to the demo app).
let fixtureTaskId;
await step("start_task (fixture 'MCP Smoke Task')", async () => {
  const tasks = envelope(await call("list_tasks", { filter: `name eq 'MCP Smoke Task'` }));
  if (tasks.total === 0) throw new Error("fixture task missing — create 'MCP Smoke Task' bound to the demo app");
  const taskId = tasks.items[0].id;
  fixtureTaskId = taskId;
  await call("start_task", { taskId });
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const t = envelope(await call("list_tasks", { filter: `name eq 'MCP Smoke Task'` })).items[0];
    if (t.lastStatus === "FinishedSuccess") return `FinishedSuccess after ~${(i + 1) * 5}s`;
    if (["FinishedFail", "Error", "Aborted"].includes(t.lastStatus)) throw new Error(`task ended ${t.lastStatus}`);
  }
  throw new Error("task did not finish within 120s");
});

// ---- ops tools (Tier 2): reload forensics, engine health, rule audit, QPS
if (fixtureTaskId) {
  await step("get_reload_log returns status + script-log tail", async () => {
    const r = JSON.parse(await call("get_reload_log", { taskId: fixtureTaskId, tailLines: 50 }));
    if (r.status !== "FinishedSuccess") throw new Error(`status=${r.status}, want FinishedSuccess`);
    if (!r.log || !Array.isArray(r.log.lines) || r.log.lines.length === 0) {
      throw new Error(`no log lines: ${JSON.stringify(r).slice(0, 200)}`);
    }
    return `status=${r.status} logLines=${r.log.lines.length}/${r.log.totalLines} details=${r.details.length}`;
  });
}

await step("engine_healthcheck", async () => {
  const h = JSON.parse(await call("engine_healthcheck"));
  if (typeof h.saturated !== "boolean") throw new Error(`saturated not boolean: ${JSON.stringify(h).slice(0, 200)}`);
  if (!h.version) throw new Error("no engine version");
  return `version=${h.version} saturated=${h.saturated} loadedDocs=${h.apps.loadedDocs} sessions=${JSON.stringify(h.sessions)}`;
});

await step("security_rule_audit", async () => {
  const a = JSON.parse(await call("security_rule_audit", { limit: 5 }));
  if (!(a.totalRules > 0) || !(a.shippedRules > 0)) throw new Error(`implausible counts: ${JSON.stringify(a).slice(0, 200)}`);
  if (!Array.isArray(a.findings)) throw new Error("no findings array");
  // Shipped wildcard rules (RootAdmin, resourceFilter '*', type ReadOnly)
  // must NOT be flagged as risky custom rules.
  const shippedFlagged = a.findings.some((f) => ["RootAdmin", "OwnerRead", "ServiceAccount"].includes(f.ruleName) && f.severity === "high");
  if (shippedFlagged) throw new Error("shipped ReadOnly rule flagged as risky custom rule");
  const decoded = a.rules.items.every((r) => Array.isArray(r.actions));
  if (!decoded) throw new Error("actions not decoded");
  return `rules=${a.totalRules} (shipped=${a.shippedRules} custom=${a.customRules} disabled=${a.disabledRules}) findings=${a.findings.length}`;
});

// QPS tools register only when certificate material is configured (the QPS
// REST API is certificate-only) — skip cleanly when absent.
const hasQps = tools.tools.some((t) => t.name === "list_user_sessions");
if (hasQps) {
  await step("list_user_sessions (nonexistent user -> 0 sessions)", async () => {
    const r = JSON.parse(await call("list_user_sessions", { directory: "SMOKE", userId: "nobody" }));
    if (typeof r.sessionCount !== "number") throw new Error(`bad shape: ${JSON.stringify(r).slice(0, 200)}`);
    return `sessionCount=${r.sessionCount}`;
  });
  await step("end_user_sessions (nonexistent user -> 0 ended)", async () => {
    const r = JSON.parse(await call("end_user_sessions", { directory: "SMOKE", userId: "nobody" }));
    if (r.endedSessions !== 0) throw new Error(`expected 0 ended, got ${r.endedSessions}`);
    return `endedSessions=${r.endedSessions}`;
  });
} else {
  log("SKIP QPS session tools", "no certificate material configured (QPS REST is certificate-only)");
}

await client.close();
console.log(failures === 0 ? "SMOKE: ALL PASS" : `SMOKE: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
