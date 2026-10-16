import { HEX_COLOR, SORT_CRITERIA, SERIES_TYPES, type DimSpec, type DimSort, type MeasureSpec, type SeriesType } from "./inputs.js";
import { numberFormatFromEngine } from "./number-format.js";
import { ToolError } from "../core/errors.js";
import type { GenericObjectProperties, HyperCubeDef, NxInlineDimensionDef, NxMeasure, NxSortCriteria } from "../qix/types.js";

/** A hypercube dimension or a qListObjectDef — both carry qDef + qLibraryId. */
type DimEntry = { qDef?: NxInlineDimensionDef; qLibraryId?: string; qNullSuppression?: boolean };

// ── Reading specs back out of an existing object (update_sheet_object) ──────

const sameCriteria = (a: NxSortCriteria | undefined, b: Record<string, number>) =>
  !!a && Object.keys(b).every((k) => (a[k] ?? 0) === b[k]);

/** A hypercube dimension or qListObjectDef -> DimSpec. Throws when the entry
 *  is neither a field/calculated def nor a master link. */
export function dimSpecFromDef(entry: DimEntry | undefined, where = "dimension"): DimSpec {
  let out: DimSpec;
  if (entry?.qLibraryId) {
    out = { libraryId: entry.qLibraryId };
  } else {
    const fd = entry?.qDef?.qFieldDefs?.[0];
    if (typeof fd !== "string" || !fd) throw new ToolError("VALIDATION_REFUSED", `${where}: no field definition and no master link — pass dimensions explicitly`);
    out = fd.startsWith("=") ? { expression: fd } : { field: fd };
    const label = entry?.qDef?.qFieldLabels?.[0];
    if (typeof label === "string" && label) out.label = label;
  }
  if (entry?.qDef?.autoSort === false) {
    const crit = entry.qDef?.qSortCriterias?.[0];
    const sort = (Object.keys(SORT_CRITERIA) as DimSort[]).find((k) => sameCriteria(crit, SORT_CRITERIA[k]));
    if (sort) out.sort = sort;
  }
  if (entry?.qNullSuppression === true) out.includeNulls = false;
  return out;
}

/** Every dimension of a hypercube. In a pivot (qMode "P") the dimensions
 *  after the first qNoOfLeftDims are its columns. */
export function cubeDimSpecs(hc: Partial<HyperCubeDef>): DimSpec[] {
  const dims = (hc.qDimensions ?? []).map((d, i) => dimSpecFromDef(d, `dimension ${i}`));
  const left = hc.qNoOfLeftDims;
  if (hc.qMode === "P" && typeof left === "number" && left >= 1) {
    for (let i = left; i < dims.length; i++) dims[i].pivotColumn = true;
  }
  return dims;
}

/** A hypercube measure -> MeasureSpec (expression or link, label, format, color). */
export function measureSpecFromDef(entry: Partial<NxMeasure> | undefined, where = "measure"): MeasureSpec {
  let out: MeasureSpec;
  if (entry?.qLibraryId) {
    out = { libraryId: entry.qLibraryId };
  } else {
    const e = entry?.qDef?.qDef;
    if (typeof e !== "string" || !e.trim()) throw new ToolError("VALIDATION_REFUSED", `${where}: no expression and no master link — pass measures explicitly`);
    out = { expression: e };
    const label = entry?.qDef?.qLabel;
    if (typeof label === "string" && label) out.label = label;
  }
  const nf = numberFormatFromEngine(entry?.qDef);
  if (nf) out.numberFormat = nf;
  // bar/line charts keep a measure color in qDef.coloring; the combo chart
  // client writes qDef.color instead (harvested from a client-authored combo).
  const comboColor = entry?.qDef?.color as { on?: boolean; paletteColor?: { color?: unknown } } | undefined;
  const color = entry?.qDef?.coloring?.baseColor?.color ?? (comboColor?.on !== false ? comboColor?.paletteColor?.color : undefined);
  if (typeof color === "string" && HEX_COLOR.test(color)) out.color = color;
  const series = entry?.qDef?.series as { type?: unknown; axis?: unknown } | undefined;
  if (series && typeof series === "object" && SERIES_TYPES.includes(series.type as SeriesType)) {
    out.series = { type: series.type as SeriesType, axis: series.axis === 1 ? "secondary" : "primary" };
  }
  return out;
}

/** Dims + measures of a hypercube or listbox object's properties. */
export function specsFromProps(
  props: Pick<GenericObjectProperties, "qHyperCubeDef" | "qListObjectDef">,
): { dimensions: DimSpec[]; measures: MeasureSpec[] } {
  if (props.qListObjectDef) return { dimensions: [dimSpecFromDef(props.qListObjectDef, "listbox")], measures: [] };
  const hc: Partial<HyperCubeDef> = props.qHyperCubeDef ?? {};
  return {
    dimensions: cubeDimSpecs(hc),
    measures: (hc.qMeasures ?? []).map((m, i) => measureSpecFromDef(m, `measure ${i}`)),
  };
}
