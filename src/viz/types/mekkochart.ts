import { clientCube } from "../build.js";
import type { ChartType } from "./contract.js";

export const mekkochart: ChartType = {
  name: "mekkochart",
  spec: { minDims: 2, maxDims: 2, minMeasures: 1, maxMeasures: 1, cube: "hypercube", renderVerified: false },
  minTile: { colspan: 8, rowspan: 6 },
  build: (input) => ({
    ...input.base,
    showTitles: true, subtitle: "", footnote: "",
    qHyperCubeDef: clientCube(input, { qInitialDataFetch: [{ qLeft: 0, qTop: 0, qWidth: 3, qHeight: 3333 }], qSuppressZero: true }),
    cellColor: { mode: "auto", legend: { show: "auto", showTitle: true } },
  }),
};
