// linechart: nebula. No sortByMeasure — a time axis sorted by value is nonsense.

import { buildCube } from "../build.js";
import type { ChartType } from "./contract.js";

export const linechart: ChartType = {
  name: "linechart",
  spec: { minDims: 1, maxDims: 2, minMeasures: 1, maxMeasures: 9, cube: "hypercube" },
  nebula: true,
  options: ["colorMode", "showLegend", "showDataLabels", "includeZeros"],
  measureColors: true,
  build: (input) => buildCube(input, { nebula: true }),
};
