// No measures: the client bins and counts the dimension's values.

import { clientCube } from "../build.js";
import type { ChartType } from "./contract.js";

export const histogram: ChartType = {
  name: "histogram",
  spec: { minDims: 1, maxDims: 1, minMeasures: 0, maxMeasures: 0, cube: "hypercube", renderVerified: false },
  options: ["colorMode", "showDataLabels"],
  colorModes: ["auto", "single"],
  build: (input) => {
    const { base, applied } = input;
    const single = applied.colorMode === "single" && applied.color;
    return {
      ...base,
      showTitles: true, subtitle: "", footnote: "",
      qHyperCubeDef: clientCube(input, { qAlwaysFullyExpanded: true }),
      bins: { auto: true, binCount: "", binSize: 10, offset: 0, countDistinct: false, binMode: "maxCount" },
      color: { bar: { paletteColor: single ? { index: -1, color: applied.color } : { index: 6, color: "#4477aa" } } },
      dataPoint: { showLabels: applied.showDataLabels ?? false },
      dimensionAxis: { dock: "near", label: "auto", show: "all" },
      measureAxis: { autoMinMax: true, dock: "near", label: "", max: 10, min: 0, minMax: "min", show: "all", spacing: 1 },
      gridlines: { auto: true, spacing: 2 },
      refLine: { refLines: [] },
      sorting: { autoSort: true },
    };
  },
};
