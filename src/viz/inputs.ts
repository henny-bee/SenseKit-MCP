import { numFormatToEngine, type NumberFormatSpec } from "./number-format.js";
import { ToolError } from "../core/errors.js";

export const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export type DimSort = "asc" | "desc" | "loadOrder";

// Exactly one of field/expression/libraryId; expression keeps its "=" (qFieldDefs needs it).
export interface DimSpec {
  field?: string;
  expression?: string;
  libraryId?: string;
  label?: string;
  sort?: DimSort;
  /** false = qNullSuppression ("Include null values" unticked). */
  includeNulls?: boolean;
  /** pivot-table only: across the top; must come after all row dimensions. */
  pivotColumn?: boolean;
}
export type DimInput = string | DimSpec;

// Expression kept as given: each builder adds or strips "=" as its client does.
export interface MeasureSpec {
  expression?: string;
  libraryId?: string;
  label?: string;
  numberFormat?: NumberFormatSpec;
  color?: string;
  /** combochart only. */
  series?: SeriesSpec;
  /** bulletchart only: target marker expression. */
  target?: string;
  /** waterfallchart only. */
  operation?: WaterfallOperation;
  /** waterfallchart only: label of a subtotal bar after this measure. */
  subtotal?: string;
  /** kpi only: value colors; no limits = one fixed color. */
  colorBands?: ColorBands;
}
export type MeasureInput = string | MeasureSpec;

// colors[i] is used below limits[i]; the last color above the top limit.
export interface ColorBands { limits: number[]; colors: string[] }

export type SeriesType = "bar" | "line" | "marker";
export type SeriesAxis = "primary" | "secondary";
export interface SeriesSpec { type?: SeriesType; axis?: SeriesAxis }
export type WaterfallOperation = "add" | "subtract" | "subtotal";

const DIM_SORTS: readonly DimSort[] = ["asc", "desc", "loadOrder"];
export const SERIES_TYPES: readonly SeriesType[] = ["bar", "line", "marker"];
export const SERIES_AXES: readonly SeriesAxis[] = ["primary", "secondary"];
export const WATERFALL_OPERATIONS: readonly WaterfallOperation[] = ["add", "subtract", "subtotal"];

function optionalBoolean(where: string, key: string, v: unknown): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw new ToolError("INVALID_INPUT", `${where}: ${key} must be true or false`);
  return v;
}

function exactlyOne<T extends object>(where: string, obj: T, keys: ReadonlyArray<keyof T & string>): keyof T & string {
  const given = keys.filter((k) => obj[k] !== undefined);
  if (given.length !== 1) {
    throw new ToolError("INVALID_INPUT", `${where}: exactly one of ${keys.join(", ")} is required (got ${given.length ? given.join(", ") : "none"})`);
  }
  const v = obj[given[0]];
  if (typeof v !== "string" || !v.trim()) throw new ToolError("INVALID_INPUT", `${where}: ${given[0]} must be a non-empty string`);
  return given[0];
}

// A leading "=" is a calculated dim: pre-flight CheckExpressions it, not a field lookup.
export function normalizeDims(inputs: ReadonlyArray<DimInput> = []): DimSpec[] {
  return inputs.map((d, i) => {
    const where = `dimensions[${i}]`;
    if (typeof d === "string") {
      if (!d.trim()) throw new ToolError("INVALID_INPUT", `${where}: empty field name`);
      return d.startsWith("=") ? { expression: d } : { field: d };
    }
    if (d === null || typeof d !== "object") throw new ToolError("INVALID_INPUT", `${where}: must be a field name or an object`);
    const key = exactlyOne(where, d, ["field", "expression", "libraryId"]);
    const out: DimSpec = {};
    if (key === "field") {
      if (d.field!.startsWith("=")) {
        throw new ToolError("INVALID_INPUT", `${where}: field "${d.field}" starts with "=" — pass it as expression (a calculated dimension)`);
      }
      out.field = d.field;
    } else if (key === "expression") {
      const e = d.expression!.trim();
      out.expression = e.startsWith("=") ? e : `=${e}`;
    } else {
      out.libraryId = d.libraryId!.trim();
    }
    if (d.label !== undefined) out.label = d.label;
    if (d.sort !== undefined) {
      if (!DIM_SORTS.includes(d.sort)) throw new ToolError("INVALID_INPUT", `${where}: sort must be one of ${DIM_SORTS.join(", ")}`);
      out.sort = d.sort;
    }
    const includeNulls = optionalBoolean(where, "includeNulls", d.includeNulls);
    if (includeNulls !== undefined) out.includeNulls = includeNulls;
    const pivotColumn = optionalBoolean(where, "pivotColumn", d.pivotColumn);
    if (pivotColumn !== undefined) out.pivotColumn = pivotColumn;
    return out;
  });
}

export function normalizeMeasures(inputs: ReadonlyArray<MeasureInput> = []): MeasureSpec[] {
  return inputs.map((m, i) => {
    const where = `measures[${i}]`;
    if (typeof m === "string") {
      if (!m.trim() || m.trim() === "=") throw new ToolError("INVALID_INPUT", `${where}: empty expression`);
      return { expression: m };
    }
    if (m === null || typeof m !== "object") throw new ToolError("INVALID_INPUT", `${where}: must be an expression or an object`);
    const key = exactlyOne(where, m, ["expression", "libraryId"]);
    const out: MeasureSpec = key === "expression" ? { expression: m.expression!.trim() } : { libraryId: m.libraryId!.trim() };
    if (out.expression === "=") throw new ToolError("INVALID_INPUT", `${where}: empty expression`);
    if (m.label !== undefined) out.label = m.label;
    if (m.numberFormat !== undefined) {
      try { numFormatToEngine(m.numberFormat); } catch (e) {
        throw new ToolError("INVALID_INPUT", `${where}: ${e instanceof Error ? e.message : String(e)}`);
      }
      out.numberFormat = m.numberFormat;
    }
    if (m.color !== undefined) {
      if (!HEX_COLOR.test(m.color)) throw new ToolError("INVALID_INPUT", `${where}: color must be a hex color like #1f77b4, got "${m.color}"`);
      out.color = m.color;
    }
    if (m.series !== undefined) {
      const s = m.series;
      if (s === null || typeof s !== "object") throw new ToolError("INVALID_INPUT", `${where}: series must be an object {type?, axis?}`);
      if (s.type !== undefined && !SERIES_TYPES.includes(s.type)) throw new ToolError("INVALID_INPUT", `${where}: series.type must be one of ${SERIES_TYPES.join(", ")}`);
      if (s.axis !== undefined && !SERIES_AXES.includes(s.axis)) throw new ToolError("INVALID_INPUT", `${where}: series.axis must be one of ${SERIES_AXES.join(", ")}`);
      out.series = { ...(s.type !== undefined ? { type: s.type } : {}), ...(s.axis !== undefined ? { axis: s.axis } : {}) };
    }
    if (m.target !== undefined) {
      if (typeof m.target !== "string" || !m.target.trim() || m.target.trim() === "=") throw new ToolError("INVALID_INPUT", `${where}: target must be an expression`);
      out.target = m.target.trim();
    }
    if (m.operation !== undefined) {
      if (!WATERFALL_OPERATIONS.includes(m.operation)) throw new ToolError("INVALID_INPUT", `${where}: operation must be one of ${WATERFALL_OPERATIONS.join(", ")}`);
      out.operation = m.operation;
    }
    if (m.subtotal !== undefined) {
      if (typeof m.subtotal !== "string" || !m.subtotal.trim()) throw new ToolError("INVALID_INPUT", `${where}: subtotal must be a label`);
      out.subtotal = m.subtotal;
    }
    if (m.colorBands !== undefined) out.colorBands = checkColorBands(where, m.colorBands);
    return out;
  });
}

export function checkColorBands(where: string, bands: ColorBands): ColorBands {
  const { limits, colors } = bands ?? {};
  if (!Array.isArray(limits) || !limits.every((v, i) => Number.isFinite(v) && (i === 0 || v > limits[i - 1]))) {
    throw new ToolError("INVALID_INPUT", `${where}: colorBands.limits must be numbers in ascending order`);
  }
  if (!Array.isArray(colors) || colors.length !== limits.length + 1 || !colors.every((c) => HEX_COLOR.test(c))) {
    throw new ToolError("INVALID_INPUT", `${where}: colorBands.colors must be ${limits.length + 1} hex colors (one more than limits), lowest band first`);
  }
  return { limits: [...limits], colors: [...colors] };
}

export const withEq = (e: string) => (e.startsWith("=") ? e : `=${e}`);
export const noEq = (e: string) => (e.startsWith("=") ? e.slice(1) : e);
export const fieldDef = (d: DimSpec) => d.field ?? d.expression ?? "";

export const SORT_CRITERIA: Record<DimSort, Record<string, number>> = {
  asc: { qSortByNumeric: 1, qSortByAscii: 1, qSortByLoadOrder: 1 },
  desc: { qSortByNumeric: -1, qSortByAscii: -1, qSortByLoadOrder: 1 },
  loadOrder: { qSortByNumeric: 0, qSortByAscii: 0, qSortByLoadOrder: 1 },
};
