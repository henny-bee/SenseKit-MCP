import { z } from "zod";
import { HEX_COLOR } from "./inputs.js";
import { NAVIGATION_ACTIONS } from "./types/contract.js";

export const positionSchema = z.object({
  col: z.number().int().min(0),
  row: z.number().int().min(0),
  colspan: z.number().int().positive(),
  rowspan: z.number().int().positive(),
}).describe("Grid cell (sheet grid is columns x rows, default 24x12)");

// Exactly-one-of rules live in normalizeDims/Measures: clearer errors than a zod refine.
const hexColorSchema = z.string().regex(HEX_COLOR, "must be a hex color like #1f77b4");

export const numberFormatSchema = z.object({
  type: z.enum(["auto", "number", "integer", "percent", "money", "date", "custom"]),
  pattern: z.string().optional().describe("Qlik format pattern, e.g. '#,##0.00', '0.0%', '$#,##0', 'YYYY-MM-DD' (required for custom)"),
  decimals: z.number().int().min(0).max(15).optional().describe("Decimals when no pattern is given"),
}).strict();

export const dimensionInputSchema = z.union([
  z.string().describe("Field name (a leading '=' makes it a calculated dimension)"),
  z.object({
    field: z.string().optional().describe("Field name"),
    expression: z.string().optional().describe("Calculated dimension, e.g. '=Year(OrderDate)'"),
    libraryId: z.string().optional().describe("Master dimension id (list_master_dimensions)"),
    label: z.string().optional().describe("Column/axis label"),
    sort: z.enum(["asc", "desc", "loadOrder"]).optional(),
    includeNulls: z.boolean().optional().describe("false hides the null ('-') row, like unticking 'Include null values' (charts and tables)"),
    pivotColumn: z.boolean().optional().describe("pivot-table only: show this dimension as columns; column dimensions must come after the row dimensions"),
  }).strict().describe("Exactly one of field / expression / libraryId"),
]);

export const measureInputSchema = z.union([
  z.string().describe("Measure expression, e.g. 'Sum(Sales)'"),
  z.object({
    expression: z.string().optional().describe("Measure expression"),
    libraryId: z.string().optional().describe("Master measure id (list_master_measures)"),
    label: z.string().optional().describe("Measure label (inline measures only)"),
    numberFormat: numberFormatSchema.optional(),
    color: hexColorSchema.optional().describe("Per-measure color (bar/line/combo charts)"),
    series: z.object({
      type: z.enum(["bar", "line", "marker"]).optional().describe("Default bar"),
      axis: z.enum(["primary", "secondary"]).optional().describe("Default primary"),
    }).strict().optional().describe("combochart only: bar/line/marker and primary/secondary axis"),
    target: z.string().optional().describe("bulletchart only: target marker expression, e.g. 'Sum(Budget)'"),
    operation: z.enum(["add", "subtract", "subtotal"]).optional().describe("waterfallchart only: add (default), subtract, or subtotal (shows the running total; its expression is not used)"),
    subtotal: z.string().optional().describe("waterfallchart only: add a subtotal bar with this label after the measure"),
    colorBands: z.object({
      limits: z.array(z.number()).describe("Ascending thresholds, e.g. [0] or [0.18, 0.2]"),
      colors: z.array(hexColorSchema).describe("One more than limits, lowest band first: colors[i] below limits[i], the last above the top limit"),
    }).strict().optional().describe("kpi only: color the value by thresholds, e.g. {limits:[0], colors:['#c0392b','#2e7d32']} = red below 0, green from 0; {limits:[], colors:['#1f3a5f']} = one fixed color"),
  }).strict().describe("Exactly one of expression / libraryId"),
]);

export const vizOptionsSchema = z.object({
  colorMode: z.enum(["auto", "single", "byDimension", "byMeasure"]).optional(),
  color: hexColorSchema.optional().describe("Color for colorMode 'single'"),
  showLegend: z.boolean().optional(),
  showDataLabels: z.boolean().optional(),
  orientation: z.enum(["vertical", "horizontal"]).optional().describe("barchart, bulletchart, boxplot, distributionplot"),
  stacked: z.boolean().optional().describe("barchart only"),
  sortByMeasure: z.enum(["asc", "desc"]).optional().describe("Sort by the first measure"),
  includeZeros: z.boolean().optional().describe("false hides rows whose measures are all zero, like unticking 'Include zero values'"),
  navigateTo: z.object({
    action: z.enum(NAVIGATION_ACTIONS).describe("goToSheet needs sheetId; openWebsite needs url; none removes the navigation"),
    sheetId: z.string().optional().describe("goToSheet: target sheet id (list_sheets)"),
    url: z.string().optional().describe("openWebsite: http(s):// or mailto: URL"),
    sameWindow: z.boolean().optional().describe("openWebsite: open in the same tab (default: new tab)"),
  }).strict().optional().describe("action-button only: where a click navigates"),
}).strict();
