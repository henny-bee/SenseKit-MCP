#!/usr/bin/env node
import { loadConfig } from "../dist/config.js";
import { EngineClient } from "../dist/clients/engine.js";

const appId = process.argv[2];
if (!appId) { console.error("usage: fixture_sheet.mjs <appId>"); process.exit(2); }

const cfg = loadConfig();
const engine = new EngineClient(cfg);
const app = await engine.app(appId);

const ml = await app.createSessionObject({
  qInfo: { qType: "fixture-ml" },
  qMeasureListDef: { qType: "measure", qData: {} },
});
const mlLayout = await ml.getLayout();
let measureId = (mlLayout.qMeasureList?.qItems ?? [])
  .find((m) => m.qMeta?.title === "Smoke Revenue")?.qInfo?.qId;
await app.destroySessionObject(ml.id).catch(() => {});
if (!measureId) {
  const created = await app.createMeasure({
    qInfo: { qType: "measure" },
    qMeasure: { qLabel: "Smoke Revenue", qDef: "Sum(Sales)", qGrouping: "N" },
    qMetaDef: { title: "Smoke Revenue", description: "Fixture for inspector smoke" },
  });
  measureId = (await created.getLayout()).qInfo.qId;
  console.log("created master measure", measureId);
} else {
  console.log("master measure exists", measureId);
}

const sl = await app.createSessionObject({
  qInfo: { qType: "fixture-sl" },
  qAppObjectListDef: { qType: "sheet", qData: { title: "/qMetaDef.title" } },
});
const slLayout = await sl.getLayout();
let sheetId = (slLayout.qAppObjectList?.qItems ?? [])
  .find((s) => s.qMeta?.title === "MCP Smoke Sheet")?.qInfo?.qId;
await app.destroySessionObject(sl.id).catch(() => {});

if (!sheetId) {
  const sheet = await app.createObject({
    qInfo: { qType: "sheet" },
    qMetaDef: { title: "MCP Smoke Sheet", description: "Fixture for inspector smoke" },
    rows: 24, columns: 24,
    cells: [],
    qChildListDef: { qData: { title: "/title" } },
  });
  sheetId = (await sheet.getLayout()).qInfo.qId;
  const kpi = await sheet.createChild({
    qInfo: { qType: "kpi" },
    visualization: "kpi",
    title: "Total Sales KPI",
    qHyperCubeDef: {
      qDimensions: [],
      qMeasures: [{ qLibraryId: measureId, qDef: {} }],
      qInitialDataFetch: [{ qLeft: 0, qTop: 0, qWidth: 1, qHeight: 1 }],
    },
  });
  const kpiId = (await kpi.getLayout()).qInfo.qId;
  const props = await sheet.getProperties();
  props.cells = [{ name: kpiId, type: "kpi", col: 0, row: 0, colspan: 8, rowspan: 6 }];
  await sheet.setProperties(props);
  console.log("created sheet", sheetId, "kpi", kpiId);
} else {
  console.log("sheet exists", sheetId);
}

// Published app: owner items stay private to other users until published.
try {
  const sheet = await app.getObject(sheetId);
  await sheet.publish();
  console.log("sheet published");
} catch (e) {
  console.log("sheet publish:", String(e.message ?? e).slice(0, 80));
}
try {
  const measure = await app.getMeasure(measureId);
  await measure.publish();
  console.log("measure published");
} catch (e) {
  console.log("measure publish:", String(e.message ?? e).slice(0, 80));
}

await app.doSave();
console.log("fixture ready");
await engine.close();
process.exit(0);
