// scatterplot: nebula. Data labels live in a different block (labels.mode)
// and are not wired; there is no category order to sort by value.

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
      // scatter uses AXIS-SPECIFIC reference lines; the generic refLine.refLines
      // shape leaves it with nothing to iterate and it renders blank silently.
      refLine: { refLinesX: [], refLinesY: [] },
    },
  }),
};
