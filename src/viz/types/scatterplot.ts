import { buildCube } from "../build.js";
import type { ChartType } from "./contract.js";

export const scatterplot: ChartType = {
  name: "scatterplot",
  spec: { minDims: 1, maxDims: 1, minMeasures: 2, maxMeasures: 3, cube: "hypercube" },
  minTile: { colspan: 8, rowspan: 6 },
  nebula: true,
  options: ["colorMode", "showLegend", "includeZeros"],
  build: (input) => buildCube(input, {
    nebula: true,
    extras: {
      dataPoint: { auto: true, bubbleSizes: "auto", rangeBubbleSizes: [2, 8], showLabels: false },
      compressionResolution: "auto", navigation: false, colorMode: "primary",
      // Axis-specific refLines: the generic refLine.refLines shape renders blank.
      refLine: { refLinesX: [], refLinesY: [] },
    },
  }),
};
