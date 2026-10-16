// pivot-table: qMode 'P' required — a straight cube renders empty. Pivot
// sorts per dimension, so the cube-level sortByMeasure does not apply.

import { buildCube } from "../build.js";
import type { ChartType } from "./contract.js";

export const pivotTable: ChartType = {
  name: "pivot-table",
  spec: { minDims: 1, maxDims: 99, minMeasures: 1, maxMeasures: 99, cube: "hypercube", pivot: true },
  build: (input) => buildCube(input, { pivot: true }),
};
