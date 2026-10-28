import { fieldDef, noEq } from "../inputs.js";
import { finishDim, finishNulls, finishMeasure, applyOptions } from "../build.js";
import type { ChartType } from "./contract.js";

export const treemap: ChartType = {
  name: "treemap",
  spec: { minDims: 1, maxDims: 9, minMeasures: 1, maxMeasures: 1, cube: "hypercube" },
  minTile: { colspan: 8, rowspan: 8 },
  options: ["colorMode", "showLegend", "showDataLabels", "includeZeros"],
  build: ({ viz, base, dims, meas, applied }) => {
    // Keep lean and client-shaped: NEBULA_DEFAULTS keys break sn-treemap.
    return applyOptions({
      ...base,
      showTitles: true, subtitle: "", footnote: "", showDetails: true,
      showDisclaimer: true, disableNavMenu: false,
      // Flat booleans, key "leaves": a nested {auto,show} shape errors.
      labels: { auto: true, headers: true, overlay: true, leaves: true, values: false },
      legend: { show: false, dock: "auto", showTitle: true },
      color: {
        auto: false, mode: "byDimension", formatting: { numFormatFromTemplate: true },
        useBaseColors: "off", paletteColor: { index: 6 }, useDimColVal: true,
        useMeasureGradient: true, persistent: false, expressionIsColor: true,
        expressionLabel: "", measureScheme: "sg", reverseScheme: false,
        autoMinMax: true, measureMin: 0, measureMax: 10,
      },
      tooltip: { auto: true, hideBasic: false, title: "", description: "" },
      qHyperCubeDef: {
        qDimensions: dims.map((d, i) => finishNulls(finishDim({
          qDef: { qGrouping: "N", qFieldDefs: [fieldDef(d)], qSortCriterias: [{ qSortByNumeric: 1, qSortByAscii: 1, qSortByLoadOrder: 1 }], autoSort: true, cId: `d${i + 1}`, othersLabel: "Others" },
          qOtherTotalSpec: {}, qAttributeExpressions: [], qAttributeDimensions: [],
        }, d), d)),
        qMeasures: meas.map((m, i) => finishMeasure({
          // no leading "=", as the client stores it
          qDef: { qGrouping: "N", qDef: noEq(m.expression ?? ""), qLabel: "", qNumFormat: { qType: "U" }, autoSort: true, cId: `m${i + 1}`, numFormatFromTemplate: true },
          qSortBy: { qSortByNumeric: -1, qSortByLoadOrder: 1 },
          qAttributeExpressions: [], qAttributeDimensions: [], qTrendLines: [],
        }, m)),
        qInterColumnSortOrder: dims.map((_, i) => i).concat(meas.map((_, i) => dims.length + i)),
        qSuppressMissing: true,
        qInitialDataFetch: [{ qLeft: 0, qTop: 0, qWidth: 30, qHeight: 3000 }],
        qReductionMode: "N",
        qMode: "K", // tree mode; "S" renders the error state
        qPseudoDimPos: -1, qNoOfLeftDims: -1, qAlwaysFullyExpanded: true,
        qMaxStackedCells: 3000, qShowTotalsAbove: true, qIndentMode: true,
        qSortbyYValue: -1, qColumnOrder: [],
      },
    }, viz, applied);
  },
};
