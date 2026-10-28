import { noEq } from "../inputs.js";
import { finishMeasure } from "../build.js";
import type { ChartType } from "./contract.js";

export const gauge: ChartType = {
  name: "gauge",
  spec: { minDims: 0, maxDims: 0, minMeasures: 1, maxMeasures: 1, cube: "hypercube" },
  build: ({ base, meas }) => {
    // Client-harvested: gaugetype/angle/segmentInfo etc. are silently required.
    return {
      ...base,
      showTitles: true, subtitle: "", footnote: "", showDetails: true,
      showDetailsExpression: false, disableNavMenu: false, disclaimerClosed: true,
      gaugetype: "radial",
      angle: 0.7,
      autoOrientation: true,
      orientation: "horizontal",
      useSegments: false,
      segmentInfo: { limits: [], paletteColors: [{ index: 6 }] },
      paletteProgressColor: { index: 6 },
      color: { useBaseColors: "measure" },
      measureAxis: { min: 0, max: 100, show: "all", spacing: 1 },
      refLine: { refLines: [] },
      components: [],
      filter: null,
      qHyperCubeDef: {
        qDimensions: [],
        qMeasures: meas.map((m, i) => finishMeasure({
          // no leading "=", as the client stores it
          qDef: {
            qTags: [], qGrouping: "N", qDef: noEq(m.expression ?? ""),
            qNumFormat: { qType: "U", qnDec: 10, qUseThou: 0 }, qAccumulate: 0,
            qActiveExpression: 0, qExpressions: [], autoSort: true,
            cId: `m${i + 1}`, numFormatFromTemplate: true,
          },
          qSortBy: { qSortByNumeric: -1, qSortByLoadOrder: 1 },
          qAttributeExpressions: [], qAttributeDimensions: [], qTrendLines: [],
        }, m)),
        qInterColumnSortOrder: [0],
        qSuppressMissing: true,
        qInitialDataFetch: [{ qLeft: 0, qTop: 0, qWidth: 1, qHeight: 1 }],
        qReductionMode: "N", qMode: "S", qPseudoDimPos: -1, qNoOfLeftDims: -1,
        qMaxStackedCells: 5000, qColumnOrder: [],
      },
    };
  },
};
