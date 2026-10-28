// qMode "K", sorted by the second column first, as the client does.

import { clientCube } from "../build.js";
import type { ChartType } from "./contract.js";

export const distributionplot: ChartType = {
  name: "distributionplot",
  spec: { minDims: 1, maxDims: 2, minMeasures: 1, maxMeasures: 1, cube: "hypercube", renderVerified: false },
  minTile: { colspan: 8, rowspan: 6 },
  options: ["orientation", "includeZeros"],
  build: (input) => {
    const { base, dims, applied } = input;
    const cube = clientCube(input, {
      qMode: "K", qAlwaysFullyExpanded: true, qSuppressZero: applied.includeZeros === false,
      qInterColumnSortOrder: dims.length > 1 ? [1, 2, 0] : [1, 0],
    });
    return {
      ...base,
      showTitles: true, subtitle: "", footnote: "",
      qHyperCubeDef: cube,
      color: {
        box: { paletteColor: { index: -1, color: "#e6e6e6" } },
        expressionLabel: "",
        point: { auto: true, mode: "primary", useBaseColors: "off", expressionIsColor: true, ...(dims.length > 1 ? { persistent: true } : {}) },
      },
      dataPoint: { bubbleScales: 100, displacement: "none" },
      dimensionAxis: { dock: "near", label: "auto", show: "all" },
      measureAxis: { autoMinMax: true, dock: "near", max: 10, min: 0, minMax: "min", show: "all", spacing: 1 },
      gridlines: { auto: true, spacing: 2 },
      orientation: applied.orientation ?? "horizontal",
      presentation: { visibleComponents: "points_box" },
      refLine: { refLines: [] },
      sorting: { autoSort: true },
    };
  },
};
