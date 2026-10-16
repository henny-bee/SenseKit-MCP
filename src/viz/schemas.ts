import { z } from "zod";
import { HEX_COLOR } from "./inputs.js";

// Sheet grid cell, shared by add_sheet_object and move_sheet_object.
export const positionSchema = z.object({
  col: z.number().int().min(0),
  row: z.number().int().min(0),
  colspan: z.number().int().positive(),
  rowspan: z.number().int().positive(),
}).describe("Grid cell (sheet grid is columns x rows, default 24x12)");

// Tool input schemas for the above. Kept beside the normalizers so the MCP
// contract and the validation rules cannot drift apart. The exactly-one-of
// rules live in normalizeDims/normalizeMeasures (better error messages than a
// zod refinement).
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
  }).strict().describe("Exactly one of expression / libraryId"),
]);

export const vizOptionsSchema = z.object({
  colorMode: z.enum(["auto", "single", "byDimension", "byMeasure"]).optional(),
  color: hexColorSchema.optional().describe("Color for colorMode 'single'"),
  showLegend: z.boolean().optional(),
  showDataLabels: z.boolean().optional(),
  orientation: z.enum(["vertical", "horizontal"]).optional().describe("barchart only"),
  stacked: z.boolean().optional().describe("barchart only"),
  sortByMeasure: z.enum(["asc", "desc"]).optional().describe("Sort by the first measure"),
  includeZeros: z.boolean().optional().describe("false hides rows whose measures are all zero, like unticking 'Include zero values'"),
}).strict();
