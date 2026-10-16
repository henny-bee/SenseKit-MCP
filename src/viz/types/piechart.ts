// piechart: nebula. Its extras were identified from the exact browser
// TypeError the chart throws without them (captured with a headless client):
// sn-pie-chart: "Cannot read properties of undefined (reading 'showAsDonut')".

import { buildCube } from "../build.js";
import type { ChartType } from "./contract.js";

export const piechart: ChartType = {
  name: "piechart",
  spec: { minDims: 1, maxDims: 1, minMeasures: 1, maxMeasures: 1, cube: "hypercube" },
  minTile: { colspan: 8, rowspan: 6 },
  nebula: true,
  options: ["colorMode", "showLegend", "showDataLabels", "sortByMeasure", "includeZeros"],
  build: (input) => buildCube(input, {
    nebula: true,
    extras: {
      donut: { showAsDonut: false, innerRadius: 50 },
      dataPoint: { auto: true, showLabels: true, showValues: false, showShares: false },
    },
  }),
};
