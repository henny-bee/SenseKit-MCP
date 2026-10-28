// The chart-type registry. Order matters: it is the order VIZ_SPECS — and so
// every tool description that lists supported types — enumerates them.

import type { ChartType } from "./contract.js";
import { kpi } from "./kpi.js";
import { gauge } from "./gauge.js";
import { barchart } from "./barchart.js";
import { linechart } from "./linechart.js";
import { combochart } from "./combochart.js";
import { piechart } from "./piechart.js";
import { scatterplot } from "./scatterplot.js";
import { treemap } from "./treemap.js";
import { bulletchart } from "./bulletchart.js";
import { boxplot } from "./boxplot.js";
import { histogram } from "./histogram.js";
import { distributionplot } from "./distributionplot.js";
import { waterfallchart } from "./waterfallchart.js";
import { mekkochart } from "./mekkochart.js";
import { table } from "./table.js";
import { pivotTable } from "./pivot-table.js";
import { listbox } from "./listbox.js";
import { textImage } from "./text-image.js";
import { filterpane } from "./filterpane.js";
import { actionButton } from "./action-button.js";

export const CHART_TYPES: readonly ChartType[] = [
  kpi, gauge, barchart, linechart, combochart, piechart, scatterplot, treemap,
  bulletchart, boxplot, histogram, distributionplot, waterfallchart, mekkochart, table, pivotTable, listbox, textImage, filterpane, actionButton,
];

export const CHART_TYPES_BY_NAME: ReadonlyMap<string, ChartType> = new Map(CHART_TYPES.map((t) => [t.name, t]));

/** Types rendered by nebula.js supernovas (see viz/build.ts NEBULA_DEFAULTS). */
export const NEBULA_CHART_TYPES = new Set(CHART_TYPES.filter((t) => t.nebula).map((t) => t.name));
