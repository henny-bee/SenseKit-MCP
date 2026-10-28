import { withEq, SORT_CRITERIA, fieldDef, type DimSpec, type MeasureSpec } from "./inputs.js";
import { numFormatToEngine } from "./number-format.js";
import type { BuildInput, VizOptions } from "./types/contract.js";
import type {
  GenericObjectProperties, HyperCubeDef, NxInlineDimensionDef, NxInlineMeasureDef, QJson,
} from "../qix/types.js";

// Without these blocks nebula supernovas render BLANK though the engine accepts the cube.
export const NEBULA_DEFAULTS: QJson = {
  showTitles: true, subtitle: "", footnote: "", showDetails: false, showDisclaimer: true,
  orientation: "vertical",
  barGrouping: { grouping: "grouped", grouping2: "grouped" },
  color: {
    auto: true, mode: "primary", formatting: { numFormatFromTemplate: true }, useBaseColors: "off",
    paletteColor: { index: 6 }, useDimColVal: true, useMeasureGradient: true, persistent: false,
    expressionIsColor: true, expressionLabel: "", measureScheme: "sg", reverseScheme: false,
    autoMinMax: true, measureMin: 0, measureMax: 10,
  },
  legend: { show: true, dock: "auto", showTitle: true, title: {} },
  dataPoint: { auto: true, showLabels: false, showSegmentLabels: false, showTotalLabels: false },
  gridLine: { auto: true, spacing: 2 },
  dimensionAxis: { show: "all", label: "auto", dock: "near", spacing: 1 },
  measureAxis: { show: "all", dock: "near", spacing: 1, autoMinMax: true, minMax: "min", min: 0, max: 10, label: "auto", logarithmic: false },
  xAxis: { show: "all", label: "auto", dock: "near", spacing: 1, autoMinMax: true, minMax: "min", min: 0, max: 10 },
  yAxis: { show: "all", label: "auto", dock: "near", spacing: 1, autoMinMax: true, minMax: "min", min: 0, max: 10 },
  tooltip: { auto: true },
  refLine: { refLines: [] },
  scrollStartPos: 0, scrollbar: "miniChart",
  totals: { show: true, position: "noTotals", label: "Totals" },
  usePagination: true,
};

// A plain field spec must stay a no-op so string inputs keep their verified output.
export function finishDim<T extends { qDef: NxInlineDimensionDef; qLibraryId?: string }>(entry: T, d: DimSpec): T {
  if (d.libraryId) {
    // Engine takes fields and label from the library; inline qFieldDefs confuse the panel.
    delete entry.qDef.qFieldDefs;
    entry.qLibraryId = d.libraryId;
  } else if (d.label !== undefined) {
    entry.qDef.qFieldLabels = [d.label];
  }
  if (d.sort) {
    // autoSort true makes the property panel re-derive and discard this sort.
    entry.qDef.qSortCriterias = [{ ...SORT_CRITERIA[d.sort] }];
    entry.qDef.autoSort = false;
  }
  return entry;
}

export function finishNulls<T extends { qDef: NxInlineDimensionDef; qNullSuppression?: boolean }>(entry: T, d: DimSpec): T {
  if (d.includeNulls === false) entry.qNullSuppression = true;
  return entry;
}

// Number format applies to master measures too: it is the client's per-chart override.
export function finishMeasure<T extends { qDef: NxInlineMeasureDef; qLibraryId?: string }>(entry: T, m: MeasureSpec): T {
  if (m.libraryId) {
    delete entry.qDef.qDef;
    entry.qLibraryId = m.libraryId;
  } else if (m.label !== undefined) {
    entry.qDef.qLabel = m.label;
  }
  if (m.numberFormat) {
    const nf = numFormatToEngine(m.numberFormat);
    if (nf) Object.assign(entry.qDef, nf);
  }
  return entry;
}

export function nebulaDim(field: string, cId: string) {
  return {
    qDef: { qFieldDefs: [field], qSortCriterias: [{ qSortByLoadOrder: 1, qSortByNumeric: 1 }], autoSort: true, cId },
    qNullSuppression: false, qOtherTotalSpec: {}, qAttributeExpressions: [], qAttributeDimensions: [], cId,
  };
}

export function nebulaMeasure(expr: string, cId: string) {
  return {
    qDef: { qDef: withEq(expr), qLabel: "", qNumFormat: { qType: "U" }, autoSort: true, cId, numFormatFromTemplate: true },
    qSortBy: { qSortByLoadOrder: 1, qSortByNumeric: -1 },
    qAttributeExpressions: [], qAttributeDimensions: [], cId, coloring: { auto: true },
  };
}

// Replace nested blocks, never mutate: they are shared refs into NEBULA_DEFAULTS.
export function applyOptions(props: GenericObjectProperties, viz: string, o: VizOptions): GenericObjectProperties {
  switch (o.colorMode) {
    case undefined: break;
    case "auto": props.color = { ...props.color, auto: true }; break;
    case "single":
      // index -1 = custom color; with a palette index the client ignores `color`.
      props.color = { ...props.color, auto: false, mode: "primary", paletteColor: { color: o.color, index: -1 } };
      break;
    case "byDimension": props.color = { ...props.color, auto: false, mode: "byDimension" }; break;
    case "byMeasure": props.color = { ...props.color, auto: false, mode: "byMeasure" }; break;
  }
  if (o.showLegend !== undefined) props.legend = { ...props.legend, show: o.showLegend };
  if (o.showDataLabels !== undefined) {
    if (viz === "treemap") props.labels = { ...props.labels, values: o.showDataLabels };
    else props.dataPoint = { ...props.dataPoint, showLabels: o.showDataLabels };
  }
  if (o.orientation) props.orientation = o.orientation;
  if (o.stacked !== undefined) props.barGrouping = { ...props.barGrouping, grouping: o.stacked ? "stacked" : "grouped" };
  if (o.sortByMeasure && props.qHyperCubeDef?.qMeasures?.length) {
    // Engine sorts by qInterColumnSortOrder; flipping qSortBy alone changes nothing.
    const cube = props.qHyperCubeDef;
    const nd = cube.qDimensions.length;
    const nm = cube.qMeasures.length;
    cube.qInterColumnSortOrder = [nd, ...Array.from({ length: nd }, (_, i) => i), ...Array.from({ length: nm - 1 }, (_, i) => nd + 1 + i)];
    const m0 = cube.qMeasures[0];
    m0.qSortBy = { ...m0.qSortBy, qSortByNumeric: o.sortByMeasure === "asc" ? 1 : -1 };
    m0.qDef.autoSort = false;
    for (const d of cube.qDimensions) d.qDef.autoSort = false;
  }
  if (o.includeZeros !== undefined && props.qHyperCubeDef) props.qHyperCubeDef.qSuppressZero = !o.includeZeros;
  return props;
}

export function clientCube(input: BuildInput, extra: Partial<HyperCubeDef> = {}): HyperCubeDef {
  const { dims, meas } = input;
  return {
    qDimensions: dims.map((d, i) => finishNulls(finishDim(nebulaDim(fieldDef(d), `d${i + 1}`), d), d)),
    qMeasures: meas.map((m, i) => finishMeasure(nebulaMeasure(m.expression ?? "", `m${i + 1}`), m)),
    qInterColumnSortOrder: [...dims, ...meas].map((_, i) => i),
    qInitialDataFetch: [{ qLeft: 0, qTop: 0, qWidth: Math.max(1, dims.length + meas.length), qHeight: 500 }],
    qMode: "S",
    qSuppressZero: false,
    qSuppressMissing: true,
    ...extra,
  };
}

export function buildCube(
  input: BuildInput,
  kind: { nebula?: boolean; extras?: QJson; pivot?: boolean } = {},
): GenericObjectProperties {
  const { viz, base, dims, meas, applied, measureColors } = input;
  const isNebula = kind.nebula === true;
  const cube: HyperCubeDef = {
    qDimensions: dims.map((d, i) => finishNulls(finishDim(
      isNebula ? nebulaDim(fieldDef(d), `d${i + 1}`) : { qDef: { qFieldDefs: [fieldDef(d)] }, qNullSuppression: false }, d), d)),
    qMeasures: meas.map((m, i) => finishMeasure(
      isNebula ? nebulaMeasure(m.expression ?? "", `m${i + 1}`) : { qDef: { qDef: withEq(m.expression ?? "") } }, m)),
    qInitialDataFetch: [{ qLeft: 0, qTop: 0, qWidth: Math.max(1, dims.length + meas.length), qHeight: 50 }],
    ...(isNebula ? {
      qSuppressZero: false, qSuppressMissing: true, qMode: "S",
      qInterColumnSortOrder: dims.map((_, i) => i).concat(meas.map((_, i) => dims.length + i)),
      // An empty columnOrder leaves sn-table with headers but no columns.
      columnOrder: [...dims, ...meas].map((_, i) => i),
      columnWidths: [...dims, ...meas].map(() => -1),
    } : {}),
  };
  if (isNebula) Object.assign(base, NEBULA_DEFAULTS, kind.extras ?? {});
  if (measureColors) {
    // Client reads the engine-echoed qDef.coloring only with useBaseColors "measure".
    meas.forEach((m, i) => {
      if (m.color) cube.qMeasures[i].qDef.coloring = { baseColor: { color: m.color, index: -1 } };
    });
    base.color = { ...base.color, auto: false, mode: "primary", useBaseColors: "measure" };
  }
  if (kind.pivot) {
    // qMode 'P' required: a straight cube saves fine but renders empty.
    cube.qMode = "P";
    cube.qAlwaysFullyExpanded = true;
    // Trailing pivotColumn dims go across the top; order checked in resolveVizOptions.
    cube.qNoOfLeftDims = dims.length - dims.filter((d) => d.pivotColumn === true).length;
    cube.qInitialDataFetch = [{ qLeft: 0, qTop: 0, qWidth: 10, qHeight: 50 }];
  }
  return applyOptions({ ...base, qHyperCubeDef: cube }, viz, applied);
}
