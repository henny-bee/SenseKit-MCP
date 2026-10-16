// treemap: needs qMode "K" (tree mode) and a LEAN, client-shaped property
// set. Render-verified after mirroring a client-authored treemap harvested
// from Qlik's shipped Content Monitor app. Its `labels` block is FLAT
// BOOLEANS (and the key is "leaves", not "leafs"); the nested {auto,show}
// shape an earlier version guessed made sn-treemap render its error state.
// Treemap refuses to draw ("This chart cannot be displayed") in a short
// tile, hence its minimum tile.

import { fieldDef, noEq } from "../inputs.js";
import { finishDim, finishMeasure, applyOptions } from "../build.js";
import type { ChartType } from "./contract.js";

export const treemap: ChartType = {
  name: "treemap",
  spec: { minDims: 1, maxDims: 9, minMeasures: 1, maxMeasures: 1, cube: "hypercube" },
  minTile: { colspan: 8, rowspan: 8 },
  options: ["colorMode", "showLegend", "showDataLabels"],
  build: ({ viz, base, dims, meas, applied }) => {
    // Mirrored from a CLIENT-AUTHORED treemap (Qlik's Content Monitor app).
    // Two things the generic path got wrong: the cube must be qMode "K"
    // (tree mode — "S" renders Qlik's error state, the same class of trap as
    // pivot-table needing "P"), and the shared kitchen-sink property block
    // injects keys sn-treemap does not expect. Keep this lean and literal.
    return applyOptions({
      ...base,
      showTitles: true, subtitle: "", footnote: "", showDetails: true,
      showDisclaimer: true, disableNavMenu: false,
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
        qDimensions: dims.map((d, i) => finishDim({
          qDef: { qGrouping: "N", qFieldDefs: [fieldDef(d)], qSortCriterias: [{ qSortByNumeric: 1, qSortByAscii: 1, qSortByLoadOrder: 1 }], autoSort: true, cId: `d${i + 1}`, othersLabel: "Others" },
          qOtherTotalSpec: {}, qAttributeExpressions: [], qAttributeDimensions: [],
        }, d)),
        qMeasures: meas.map((m, i) => finishMeasure({
          // client stores the expression WITHOUT a leading "="
          qDef: { qGrouping: "N", qDef: noEq(m.expression ?? ""), qLabel: "", qNumFormat: { qType: "U" }, autoSort: true, cId: `m${i + 1}`, numFormatFromTemplate: true },
          qSortBy: { qSortByNumeric: -1, qSortByLoadOrder: 1 },
          qAttributeExpressions: [], qAttributeDimensions: [], qTrendLines: [],
        }, m)),
        qInterColumnSortOrder: dims.map((_, i) => i).concat(meas.map((_, i) => dims.length + i)),
        qSuppressMissing: true,
        qInitialDataFetch: [{ qLeft: 0, qTop: 0, qWidth: 30, qHeight: 3000 }],
        qReductionMode: "N",
        qMode: "K",                 // tree mode — the actual fix
        qPseudoDimPos: -1, qNoOfLeftDims: -1, qAlwaysFullyExpanded: true,
        qMaxStackedCells: 3000, qShowTotalsAbove: true, qIndentMode: true,
        qSortbyYValue: -1, qColumnOrder: [],
      },
    }, viz, applied);
  },
};
