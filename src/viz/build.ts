// Shared building blocks for the per-type builders in viz/types/: the nebula
// default property blocks, dimension/measure entry finishing, the generic
// straight/pivot hypercube, and option application.

import { withEq, SORT_CRITERIA, fieldDef, type DimSpec, type MeasureSpec } from "./inputs.js";
import { numFormatToEngine } from "./number-format.js";
import type { BuildInput, VizOptions } from "./types/contract.js";
import type {
  GenericObjectProperties, HyperCubeDef, NxInlineDimensionDef, NxInlineMeasureDef, QJson,
} from "../qix/types.js";

// ── Nebula default property blocks ───────────────────────────────────────────
// Modern Sense visualizations (barchart, linechart, piechart, scatterplot,
// treemap, combochart, gauge, table) are rendered by nebula.js supernovas
// (@nebula.js/sn-*), NOT by the engine. A hypercube the engine accepts and
// evaluates perfectly will still render BLANK if these property blocks are
// absent — the supernova throws `Cannot read properties of undefined
// (reading 'auto')` in the browser and the engine never knows.
//
// Verified live (May 2026 / sn-bar-chart 2.2.0) by building each type and
// screenshotting it through a headless browser: without these blocks 8 of 12
// types render blank; with them, all render. Extra properties a given
// supernova doesn't use are ignored, so one shared block is safe.
// Which types are nebula-rendered is declared per type (ChartType.nebula).

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

// ── Dimension / measure entries ──────────────────────────────────────────────

/** Layer a spec's master link / label / sort onto a built dimension entry
 *  (a hypercube dimension or a qListObjectDef — both carry qDef.qFieldDefs).
 *  A plain field spec is a no-op: that is what keeps string inputs producing
 *  byte-identical, render-verified definitions. */
export function finishDim<T extends { qDef: NxInlineDimensionDef; qLibraryId?: string }>(entry: T, d: DimSpec): T {
  if (d.libraryId) {
    // Linked master dimension: the engine resolves fields AND label from the
    // library entry; inline qFieldDefs beside a qLibraryId only confuse the
    // property panel. The label is deliberately not written (see notes).
    delete entry.qDef.qFieldDefs;
    entry.qLibraryId = d.libraryId;
  } else if (d.label !== undefined) {
    entry.qDef.qFieldLabels = [d.label];
  }
  if (d.sort) {
    // autoSort:false — with it true the client re-derives the sort criteria
    // the next time anyone opens the property panel, discarding this one.
    entry.qDef.qSortCriterias = [{ ...SORT_CRITERIA[d.sort] }];
    entry.qDef.autoSort = false;
  }
  return entry;
}

/** "Include null values" unticked. Hypercube dimensions only (a listbox has
 *  no null row). Written only when the caller turned nulls off, so string
 *  inputs keep their render-verified definitions byte for byte. */
export function finishNulls<T extends { qDef: NxInlineDimensionDef; qNullSuppression?: boolean }>(entry: T, d: DimSpec): T {
  if (d.includeNulls === false) entry.qNullSuppression = true;
  return entry;
}

/** Same for a measure entry. The number format is applied to library-linked
 *  measures too: the client offers a per-chart format override on master
 *  measures, stored exactly here; the label it does not. */
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

/** Dimension def with the fields nebula charts expect (cId, sort, attribute arrays). */
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

/** Write the applied options onto built props. Every nested block is
 *  REPLACED, never mutated in place: on nebula types those objects are
 *  shared references into NEBULA_DEFAULTS, and mutating one would restyle
 *  every chart built after this one in the same process. */
export function applyOptions(props: GenericObjectProperties, viz: string, o: VizOptions): GenericObjectProperties {
  switch (o.colorMode) {
    case undefined: break;
    case "auto": props.color = { ...props.color, auto: true }; break;
    case "single":
      // index -1 = "custom color, not a palette slot" — with a palette index
      // the client ignores `color` and paints the theme swatch instead.
      props.color = { ...props.color, auto: false, mode: "primary", paletteColor: { color: o.color, index: -1 } };
      break;
    // byDimension without a byDimDef mirrors the render-verified treemap
    // (client-authored); the supernova colors by the first dimension.
    case "byDimension": props.color = { ...props.color, auto: false, mode: "byDimension" }; break;
    case "byMeasure": props.color = { ...props.color, auto: false, mode: "byMeasure" }; break;
  }
  if (o.showLegend !== undefined) props.legend = { ...props.legend, show: o.showLegend };
  if (o.showDataLabels !== undefined) {
    // treemap value labels are a flat boolean in its harvested `labels` block.
    if (viz === "treemap") props.labels = { ...props.labels, values: o.showDataLabels };
    else props.dataPoint = { ...props.dataPoint, showLabels: o.showDataLabels };
  }
  if (o.orientation) props.orientation = o.orientation;
  if (o.stacked !== undefined) props.barGrouping = { ...props.barGrouping, grouping: o.stacked ? "stacked" : "grouped" };
  if (o.sortByMeasure && props.qHyperCubeDef?.qMeasures?.length) {
    // The ENGINE sorts by qInterColumnSortOrder; per-item criteria only break
    // ties within that order. Putting the first measure first is the actual
    // "sort by value" — flipping qSortBy alone changes nothing visible.
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

/** A hypercube in the shape the client writes (dimensions and measures with
 *  cId, the cube flags a client-created chart starts with), for types whose
 *  supernova brings its own property set instead of NEBULA_DEFAULTS. */
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

/** The straight hypercube most types use (kpi, the nebula charts, table,
 *  pivot-table, and any unknown/extension type). `nebula` adds the default
 *  supernova blocks plus the type's own `extras`; `pivot` switches the cube
 *  to pivot mode. */
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
      // columnOrder must enumerate the columns — an empty array leaves
      // sn-table with headers but no columns (verified live).
      columnOrder: [...dims, ...meas].map((_, i) => i),
      columnWidths: [...dims, ...meas].map(() => -1),
    } : {}),
  };
  if (isNebula) Object.assign(base, NEBULA_DEFAULTS, kind.extras ?? {});
  if (measureColors) {
    // Per-measure colors: the client reads qMeasureInfo[i].coloring, which the
    // engine echoes from qDef.coloring; useBaseColors "measure" tells the
    // supernova to use them instead of the palette.
    meas.forEach((m, i) => {
      if (m.color) cube.qMeasures[i].qDef.coloring = { baseColor: { color: m.color, index: -1 } };
    });
    base.color = { ...base.color, auto: false, mode: "primary", useBaseColors: "measure" };
  }
  if (kind.pivot) {
    // A pivot-table with a straight (default) cube saves fine and renders
    // EMPTY — the qMode:'P' requirement is exactly the kind of engine-accepts
    // client-breaks inconsistency the gate exists for.
    cube.qMode = "P";
    cube.qAlwaysFullyExpanded = true;
    // Leading dimensions are rows; trailing pivotColumn ones go across the
    // top (resolveVizOptions has already checked the order).
    cube.qNoOfLeftDims = dims.length - dims.filter((d) => d.pivotColumn === true).length;
    cube.qInitialDataFetch = [{ qLeft: 0, qTop: 0, qWidth: 10, qHeight: 50 }];
  }
  return applyOptions({ ...base, qHyperCubeDef: cube }, viz, applied);
}
