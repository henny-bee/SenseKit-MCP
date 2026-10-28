// Cube lives under boxplotDef: the client derives the box/whisker measures from it.

import { clientCube } from "../build.js";
import type { ChartType } from "./contract.js";

export const boxplot: ChartType = {
  name: "boxplot",
  spec: { minDims: 1, maxDims: 2, minMeasures: 1, maxMeasures: 1, cube: "hypercube", renderVerified: false },
  minTile: { colspan: 8, rowspan: 6 },
  options: ["colorMode", "orientation", "includeZeros"],
  colorModes: ["auto", "single"],
  build: (input) => {
    const { base, applied } = input;
    const single = applied.colorMode === "single" && applied.color;
    return {
      ...base,
      showTitles: true, subtitle: "", footnote: "",
      boxplotDef: {
        qHyperCubeDef: clientCube(input, { qAlwaysFullyExpanded: true, qSuppressZero: applied.includeZeros === false }),
        calculations: { auto: true, mode: "tukey", parameters: { tukey: 1.5, fractiles: 0.01, stdDev: 3 } },
        color: {
          auto: !single, mode: "primary", useBaseColors: "off", expressionIsColor: true, expressionLabel: "",
          box: { paletteColor: single ? { index: -1, color: applied.color } : { index: -1, color: "#e6e6e6" } },
          point: { paletteColor: { index: 6, color: "#4477aa" } },
        },
        elements: {
          firstWhisker: { name: "", expression: null },
          boxStart: { name: "", expression: null },
          boxMiddle: { name: "", expression: null },
          boxEnd: { name: "", expression: null },
          lastWhisker: { name: "", expression: null },
          outliers: { include: true, sortOutliers: true },
        },
        presentation: { whiskers: { show: true } },
        sorting: { autoSort: true },
      },
      dimensionAxis: { dock: "near", label: "auto", show: "all" },
      measureAxis: { autoMinMax: true, dock: "near", max: 10, min: 0, minMax: "min", show: "all", spacing: 1 },
      gridlines: { auto: true, spacing: 2 },
      orientation: applied.orientation ?? "vertical",
      refLine: { refLines: [] },
      sorting: { autoSort: true, elementId: "firstWhisker", sortCriteria: { sortByAscii: 0, sortByExpression: 0, sortByNumeric: 0 } },
    };
  },
};
