import { buildCube } from "../build.js";
import type { ChartType } from "./contract.js";

export const table: ChartType = {
  name: "table",
  spec: { minDims: 0, maxDims: 99, minMeasures: 0, maxMeasures: 99, cube: "hypercube" },
  nebula: true,
  options: ["sortByMeasure", "includeZeros"],
  build: (input) => buildCube(input, { nebula: true }),
};
