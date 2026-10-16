// combochart: nebula, one dimension. Series and per-measure colors mirror a
// CLIENT-AUTHORED combo chart (harvested 2026-10 from a QSEoW site): the
// client stores each measure's drawing as qDef.series {type, axis: 0|1} and
// its color as qDef.color {on, mode, paletteColor} — not the qDef.coloring
// the bar and line charts read — and a chart that uses the secondary axis
// carries a two-entry measureAxes block (near, far). Plain inputs still get
// the render-verified buildCube definition unchanged.

import { buildCube } from "../build.js";
import type { ChartType } from "./contract.js";

const MEASURE_AXIS = { show: "all", spacing: 1, autoMinMax: true, minMax: "min", min: 0, max: 10 };

export const combochart: ChartType = {
  name: "combochart",
  spec: { minDims: 1, maxDims: 1, minMeasures: 1, maxMeasures: 9, cube: "hypercube" },
  nebula: true,
  options: ["colorMode", "showLegend", "showDataLabels", "sortByMeasure", "includeZeros"],
  measureColors: true,
  build: (input) => {
    const props = buildCube({ ...input, measureColors: false }, { nebula: true });
    const measures = props.qHyperCubeDef!.qMeasures;
    if (input.measureColors) {
      input.meas.forEach((m, i) => {
        if (m.color) measures[i].qDef.color = { on: true, mode: "primary", paletteColor: { index: -1, color: m.color, alpha: 1 } };
      });
    }
    // Once any measure names a series, every measure gets one, so the chart
    // never mixes explicit series with the client's own defaults.
    if (input.meas.some((m) => m.series)) {
      input.meas.forEach((m, i) => {
        measures[i].qDef.series = { type: m.series?.type ?? "bar", axis: m.series?.axis === "secondary" ? 1 : 0 };
      });
      if (input.meas.some((m) => m.series?.axis === "secondary")) {
        props.measureAxes = [{ ...MEASURE_AXIS, dock: "near" }, { ...MEASURE_AXIS, dock: "far" }];
      }
    }
    return props;
  },
};
