// Sense-native, not a supernova: takes the plain straight cube.

import { buildCube } from "../build.js";
import type { ChartType } from "./contract.js";

export const kpi: ChartType = {
  name: "kpi",
  spec: { minDims: 0, maxDims: 0, minMeasures: 1, maxMeasures: 2, cube: "hypercube" },
  build: (input) => buildCube(input),
};
