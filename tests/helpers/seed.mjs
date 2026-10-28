export const EXT_SECRET = "ExtS3cret!";

export async function seedApp(doc) {
  const app = doc.api;
  const measure = await app.createMeasure({
    qInfo: { qType: "measure" },
    qMeasure: { qLabel: "Revenue", qDef: "Sum(Sales)", qGrouping: "N" },
    qMetaDef: { title: "Revenue", description: "", tags: ["finance"] },
  });
  const dimension = await app.createDimension({
    qInfo: { qType: "dimension" },
    qDim: { qGrouping: "N", qFieldDefs: ["Region"], qFieldLabels: ["Geography"], title: "Geo" },
    qMetaDef: { title: "Geo", description: "", tags: [] },
  });
  const measureId = measure.id;
  const dimensionId = dimension.id;

  const sheet = await app.createObject({
    qInfo: { qType: "sheet" },
    qMetaDef: { title: "Overview" },
    columns: 24, rows: 12, cells: [],
  });
  const bar = await sheet.createChild({
    qInfo: { qType: "barchart" },
    visualization: "barchart",
    title: "Sales by region",
    qHyperCubeDef: {
      qDimensions: [{ qLibraryId: dimensionId, qDef: { qFieldDefs: [] } }],
      qMeasures: [{ qLibraryId: measureId, qDef: { qDef: "" } }],
    },
  });
  const kpi = await sheet.createChild({
    qInfo: { qType: "kpi" },
    visualization: "kpi",
    title: { qStringExpression: { qExpr: "='Total ' & Year(Today())" } },
    qHyperCubeDef: { qDimensions: [], qMeasures: [{ qDef: { qDef: "=Sum(Sales)", cId: "m1" } }] },
  });
  const ext = await sheet.createChild({
    qInfo: { qType: "fake-extension-viz" },
    visualization: "fake-extension-viz",
    title: "Extension",
    config: { connection: `Server=db;PWD=${EXT_SECRET};`, label: "Sales total" },
  });
  const sheetProps = await sheet.getProperties();
  sheetProps.cells = [
    { name: bar.id, type: "barchart", col: 0, row: 0, colspan: 12, rowspan: 6 },
    { name: kpi.id, type: "kpi", col: 12, row: 0, colspan: 6, rowspan: 3 },
    { name: ext.id, type: "fake-extension-viz", col: 18, row: 0, colspan: 6, rowspan: 3 },
  ];
  await sheet.setProperties(sheetProps);

  return { sheetId: sheet.id, barId: bar.id, kpiId: kpi.id, extId: ext.id, measureId, dimensionId };
}
