// Sense-native, not a supernova: takes the plain straight cube.

import { buildCube } from "../build.js";
import type { ColorBands } from "../inputs.js";
import type { ChartType } from "./contract.js";

const custom = (color: string) => ({ index: -1, color });

// Shape copied from client-authored KPIs and gauges (useConditionalColoring, not ...Color).
export function kpiColoring({ limits, colors }: ColorBands) {
  return {
    useConditionalColoring: limits.length > 0,
    singleColor: 3,
    paletteSingleColor: custom(colors[0]),
    segments: { limits: limits.map((value) => ({ value, gradient: false })), paletteColors: colors.map(custom) },
    useBaseColors: false,
  };
}

export const kpi: ChartType = {
  name: "kpi",
  spec: { minDims: 0, maxDims: 0, minMeasures: 1, maxMeasures: 2, cube: "hypercube" },
  build: (input) => {
    const props = buildCube(input);
    input.meas.forEach((m, i) => {
      if (m.colorBands) props.qHyperCubeDef!.qMeasures[i].qDef.conditionalColoring = kpiColoring(m.colorBands);
    });
    return props;
  },
};
