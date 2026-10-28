// Target is also the "bullet-target" attribute, as the client stores it.

import { applyOptions, clientCube } from "../build.js";
import { withEq } from "../inputs.js";
import type { ChartType } from "./contract.js";

export const bulletchart: ChartType = {
  name: "bulletchart",
  spec: { minDims: 0, maxDims: 1, minMeasures: 1, maxMeasures: 15, cube: "hypercube" },
  shapeRule: (nDims, nMeasures) =>
    nDims > 0 && nMeasures > 1 ? `bulletchart with a dimension takes exactly 1 measure (without a dimension, up to 15), got ${nMeasures}` : undefined,
  options: ["colorMode", "orientation", "includeZeros", "sortByMeasure"],
  colorModes: ["auto", "single"],
  build: (input) => {
    const { base, meas, applied } = input;
    const cube = clientCube(input, {
      qInitialDataFetch: [{ qLeft: 0, qTop: 0, qWidth: 15, qHeight: 500 }],
      qSuppressZero: applied.includeZeros === false,
    });
    cube.qMeasures.forEach((entry, i) => {
      const target = meas[i].target ? withEq(meas[i].target!) : "";
      Object.assign(entry.qDef, {
        target, useSegments: false, isCustomFormatted: false,
        conditionalColoring: { segments: { limits: [], paletteColors: [{ index: -1, color: "#bfbfbf" }] } },
      });
      entry.qAttributeExpressions = target ? [{ qExpression: target, id: "bullet-target" }] : [];
    });
    const single = applied.colorMode === "single" && applied.color;
    const bar = single ? { index: -1, color: applied.color } : { index: 6 };
    // Rows of one measure share a scale; separate measures keep their own.
    const common = input.dims.length > 0;
    // Sort only: applyOptions' color handling writes the bar chart's color block.
    return applyOptions({
      ...base,
      showTitles: true, subtitle: "", footnote: "", showDetails: true,
      orientation: applied.orientation ?? "horizontal",
      scrollbar: "bar", scrollStartPos: 0,
      gridLine: { auto: true, spacing: 2 },
      dataPoint: { showLabels: false, showSegmentLabels: false, showTotalLabels: true },
      // The client draws paletteColor (its "Bar color"); color.bar from the spec is never read.
      color: {
        auto: !single, mode: "primary", useBaseColors: "off", paletteColor: bar,
        target: { index: -1, color: "#000000" },
        bar,
      },
      legend: { show: true, dock: "auto", showTitle: true },
      dimensionAxis: { continuousAuto: true, show: "all", label: "auto", dock: "near" },
      measureAxis: { show: "all", dock: "near", spacing: 1, commonRange: common, commonAxis: common },
      tooltip: { auto: true, hideBasic: false, chart: { style: { size: "medium" } }, title: "", description: "" },
      qHyperCubeDef: cube,
    }, "bulletchart", { sortByMeasure: applied.sortByMeasure });
  },
};
