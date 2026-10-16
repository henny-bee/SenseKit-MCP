import { numFormatToEngine, type NumberFormatSpec } from "./number-format.js";
import { ToolError } from "../core/errors.js";

// ── Dimension / measure specs (builder inputs) ───────────────────────────────
// A dimension or measure arrives either as a bare string (the original API:
// field name / expression) or as an object carrying a label, number format,
// sort, color or a master-item link. Normalizing both into ONE shape up front
// keeps every builder path (nebula, treemap, gauge, pivot, listbox,
// filterpane) consuming the same thing, and makes the exactly-one-of rules
// testable without an engine.

export const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export type DimSort = "asc" | "desc" | "loadOrder";

/** Normalized: exactly one of field / expression / libraryId is set, and an
 *  expression always carries its leading "=" (that is how qFieldDefs tells a
 *  calculated dimension from a field name). */
export interface DimSpec {
  field?: string;
  expression?: string;
  libraryId?: string;
  label?: string;
  sort?: DimSort;
}
export type DimInput = string | DimSpec;

/** Normalized: exactly one of expression / libraryId is set. The expression
 *  is kept as given — each builder path adds or strips the leading "=" the
 *  way the client it mirrors stores it. */
export interface MeasureSpec {
  expression?: string;
  libraryId?: string;
  label?: string;
  numberFormat?: NumberFormatSpec;
  color?: string;
}
export type MeasureInput = string | MeasureSpec;

const DIM_SORTS: readonly DimSort[] = ["asc", "desc", "loadOrder"];

function exactlyOne<T extends object>(where: string, obj: T, keys: ReadonlyArray<keyof T & string>): keyof T & string {
  const given = keys.filter((k) => obj[k] !== undefined);
  if (given.length !== 1) {
    throw new ToolError("INVALID_INPUT", `${where}: exactly one of ${keys.join(", ")} is required (got ${given.length ? given.join(", ") : "none"})`);
  }
  const v = obj[given[0]];
  if (typeof v !== "string" || !v.trim()) throw new ToolError("INVALID_INPUT", `${where}: ${given[0]} must be a non-empty string`);
  return given[0];
}

/** Strings stay field names (the original API) — except a leading "=",
 *  which is a calculated dimension. The engine stores both in qFieldDefs, so
 *  the built def is byte-identical either way; the distinction matters for
 *  pre-flight, which must CheckExpression a calculated dimension instead of
 *  looking it up in the field list (where it can never be found). */
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
    return out;
  });
}

// ── Expression / sort helpers shared by the builders and the read-back ─────

export const withEq = (e: string) => (e.startsWith("=") ? e : `=${e}`);
export const noEq = (e: string) => (e.startsWith("=") ? e.slice(1) : e);
/** What goes in qFieldDefs: the field name, or the "=..." calculated dim. */
export const fieldDef = (d: DimSpec) => d.field ?? d.expression ?? "";

export const SORT_CRITERIA: Record<DimSort, Record<string, number>> = {
  asc: { qSortByNumeric: 1, qSortByAscii: 1, qSortByLoadOrder: 1 },
  desc: { qSortByNumeric: -1, qSortByAscii: -1, qSortByLoadOrder: 1 },
  loadOrder: { qSortByNumeric: 0, qSortByAscii: 0, qSortByLoadOrder: 1 },
};
