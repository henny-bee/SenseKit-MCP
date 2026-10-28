// No sortByMeasure: a pivot sorts per dimension.

import { buildCube } from "../build.js";
import type { ChartType } from "./contract.js";

export const pivotTable: ChartType = {
  name: "pivot-table",
  spec: { minDims: 1, maxDims: 99, minMeasures: 1, maxMeasures: 99, cube: "hypercube", pivot: true },
  options: ["includeZeros"],
  build: (input) => buildCube(input, { pivot: true }),
};
