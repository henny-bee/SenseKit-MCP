// barchart: the reference nebula chart — every styling option applies.

import { buildCube } from "../build.js";
import type { ChartType } from "./contract.js";

export const barchart: ChartType = {
  name: "barchart",
  spec: { minDims: 1, maxDims: 2, minMeasures: 1, maxMeasures: 9, cube: "hypercube" },
  nebula: true,
  options: ["colorMode", "showLegend", "showDataLabels", "orientation", "stacked", "sortByMeasure"],
  measureColors: true,
  build: (input) => buildCube(input, { nebula: true }),
};
