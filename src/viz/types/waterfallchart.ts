import { clientCube } from "../build.js";
import type { WaterfallOperation } from "../inputs.js";
import type { ChartType } from "./contract.js";

const VALUE_TYPE: Record<WaterfallOperation, string> = { add: "NORMAL", subtract: "INVERSE", subtotal: "SUBTOTAL" };

export const waterfallchart: ChartType = {
  name: "waterfallchart",
  spec: { minDims: 0, maxDims: 0, minMeasures: 1, maxMeasures: 50, cube: "hypercube", renderVerified: false },
  options: ["showDataLabels", "showLegend"],
  build: (input) => {
    const { base, meas, applied } = input;
    const cube = clientCube(input, { qInitialDataFetch: [{ qLeft: 0, qTop: 0, qWidth: 200, qHeight: 10 }] });
    cube.qMeasures.forEach((entry, i) => {
      entry.qDef.valueType = VALUE_TYPE[meas[i].operation ?? "add"];
      if (meas[i].subtotal) entry.qDef.subtotal = { enable: true, label: meas[i].subtotal };
    });
    return {
      ...base,
      showTitles: true, subtitle: "", footnote: "",
      qHyperCubeDef: cube,
      color: {
        auto: true,
        positiveValue: { paletteColor: { index: 6, color: null } },
        negativeValue: { paletteColor: { index: -1, color: "#cc6677" } },
        subtotal: { paletteColor: { index: -1, color: "#c3c3c3" } },
      },
      dataPoint: { showLabels: applied.showDataLabels ?? true },
      dimensionAxis: { dock: "near", label: "auto", show: "labels" },
      gridlines: { auto: true, spacing: 2 },
      legend: { dock: "auto", show: applied.showLegend ?? true },
      measureAxis: { autoMinMax: true, dock: "near", max: 10, min: 0, minMax: "min", show: "labels", spacing: 1 },
      qDef: { qNumFormat: {}, numFormatFromTemplate: true, isCustomFormatted: false },
      refLine: { refLines: [] },
    };
  },
};
