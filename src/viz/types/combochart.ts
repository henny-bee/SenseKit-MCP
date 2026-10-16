// combochart: nebula, one dimension.

import { buildCube } from "../build.js";
import type { ChartType } from "./contract.js";

export const combochart: ChartType = {
  name: "combochart",
  spec: { minDims: 1, maxDims: 1, minMeasures: 1, maxMeasures: 9, cube: "hypercube" },
  nebula: true,
  options: ["colorMode", "showLegend", "showDataLabels", "sortByMeasure"],
  measureColors: true,
  build: (input) => buildCube(input, { nebula: true }),
};
