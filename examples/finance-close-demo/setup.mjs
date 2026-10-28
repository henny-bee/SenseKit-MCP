#!/usr/bin/env node
import {
  clients, findAppByName, setScriptAndReload,
  DATAMART_NAME, DASHBOARD_NAME, CONNECTION_NAME, CONNECTION_PATH,
  DATAMART_SCRIPT, DASHBOARD_SCRIPT_CLEAN, MEASURE_TITLE, TRUTH,
} from "./common.mjs";

const { engine, qrs } = clients();

const conns = await qrs.get(`/qrs/dataconnection/full?filter=${encodeURIComponent(`name eq '${CONNECTION_NAME}'`)}`);
if (conns.length === 0) {
  await qrs.post("/qrs/dataconnection", {
    name: CONNECTION_NAME, connectionstring: CONNECTION_PATH, type: "folder",
    username: "", password: "",
  });
  console.log("created data connection", CONNECTION_NAME, "->", CONNECTION_PATH);
} else {
  console.log("data connection exists");
}

let datamartId = await findAppByName(qrs, DATAMART_NAME);
if (!datamartId) {
  const g = await engine.global();
  const created = await g.createApp(DATAMART_NAME, "main");
  datamartId = created.qAppId;
  console.log("created datamart", datamartId);
}
await setScriptAndReload(engine, datamartId, DATAMART_SCRIPT);
console.log("datamart reloaded (QVD published)");

let dashboardId = await findAppByName(qrs, DASHBOARD_NAME);
if (!dashboardId) {
  const g = await engine.global();
  const created = await g.createApp(DASHBOARD_NAME, "main");
  dashboardId = created.qAppId;
  console.log("created dashboard", dashboardId);
}
const dash = await setScriptAndReload(engine, dashboardId, DASHBOARD_SCRIPT_CLEAN);
console.log("dashboard reloaded (clean)");

const ml = await dash.createSessionObject({
  qInfo: { qType: "demo-ml" }, qMeasureListDef: { qType: "measure", qData: {} },
});
let measureId = ((await ml.getLayout()).qMeasureList?.qItems ?? [])
  .find((m) => m.qMeta?.title === MEASURE_TITLE)?.qInfo?.qId;
await dash.destroySessionObject(ml.id).catch(() => {});
if (!measureId) {
  const created = await dash.createMeasure({
    qInfo: { qType: "measure" },
    qMeasure: {
      qLabel: MEASURE_TITLE,
      qDef: "Sum({<Scenario={'Actual'}, Period={'FY2026-Q1'}>} Amount)",
      qGrouping: "N",
    },
    qMetaDef: { title: MEASURE_TITLE, description: "Certified close KPI — governed definition" },
  });
  measureId = (await created.getLayout()).qInfo.qId;
  console.log("created master measure", measureId);
}

const sl = await dash.createSessionObject({
  qInfo: { qType: "demo-sl" },
  qAppObjectListDef: { qType: "sheet", qData: { title: "/qMetaDef.title" } },
});
let sheetId = ((await sl.getLayout()).qAppObjectList?.qItems ?? [])
  .find((s) => s.qMeta?.title === "Close Review")?.qInfo?.qId;
await dash.destroySessionObject(sl.id).catch(() => {});
if (!sheetId) {
  const sheet = await dash.createObject({
    qInfo: { qType: "sheet" },
    qMetaDef: { title: "Close Review" },
    rows: 24, columns: 24, cells: [],
    qChildListDef: { qData: { title: "/title" } },
  });
  sheetId = (await sheet.getLayout()).qInfo.qId;
  const kpi = await sheet.createChild({
    qInfo: { qType: "kpi" },
    visualization: "kpi",
    title: "Revenue Q1 (Actual)",
    qHyperCubeDef: {
      qDimensions: [],
      qMeasures: [{ qLibraryId: measureId, qDef: {} }],
      qInitialDataFetch: [{ qLeft: 0, qTop: 0, qWidth: 1, qHeight: 1 }],
    },
  });
  const kpiId = (await kpi.getLayout()).qInfo.qId;
  const props = await sheet.getProperties();
  props.cells = [{ name: kpiId, type: "kpi", col: 0, row: 0, colspan: 10, rowspan: 6 }];
  await sheet.setProperties(props);
  console.log("created sheet", sheetId, "kpi", kpiId);
}
await dash.doSave();

const val = await dash.evaluateEx("Sum({<Scenario={'Actual'}, Period={'FY2026-Q1'}>} Amount)");
console.log(`dashboard KPI = ${val.qNumber} (truth ${TRUTH})`);
console.log(`datamart id  = ${datamartId}`);
console.log(`dashboard id = ${dashboardId}`);
console.log(Math.abs(val.qNumber - Number(TRUTH)) < 0.005 ? "SETUP OK — tied out" : "SETUP MISMATCH — investigate");
await engine.close();
process.exit(0);
