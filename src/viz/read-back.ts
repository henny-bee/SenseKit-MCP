import { HEX_COLOR, SORT_CRITERIA, SERIES_TYPES, type DimSpec, type DimSort, type MeasureSpec, type SeriesType, type WaterfallOperation } from "./inputs.js";
import { numberFormatFromEngine } from "./number-format.js";
import { ToolError } from "../core/errors.js";
import type { GenericObjectProperties, HyperCubeDef, NxInlineDimensionDef, NxMeasure, NxSortCriteria } from "../qix/types.js";

type DimEntry = { qDef?: NxInlineDimensionDef; qLibraryId?: string; qNullSuppression?: boolean };

const sameCriteria = (a: NxSortCriteria | undefined, b: Record<string, number>) =>
  !!a && Object.keys(b).every((k) => (a[k] ?? 0) === b[k]);

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

export function cubeDimSpecs(hc: Partial<HyperCubeDef>): DimSpec[] {
  const dims = (hc.qDimensions ?? []).map((d, i) => dimSpecFromDef(d, `dimension ${i}`));
  const left = hc.qNoOfLeftDims;
  if (hc.qMode === "P" && typeof left === "number" && left >= 1) {
    for (let i = left; i < dims.length; i++) dims[i].pivotColumn = true;
  }
  return dims;
}

export function cubeDefOf(props: Pick<GenericObjectProperties, "qHyperCubeDef" | "boxplotDef">): Partial<HyperCubeDef> | undefined {
  return props.qHyperCubeDef ?? props.boxplotDef?.qHyperCubeDef;
}

const OPERATION_OF: Record<string, WaterfallOperation> = { INVERSE: "subtract", SUBTOTAL: "subtotal" };

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
  // The combo chart client writes qDef.color instead of qDef.coloring.
  const comboColor = entry?.qDef?.color as { on?: boolean; paletteColor?: { color?: unknown } } | undefined;
  const color = entry?.qDef?.coloring?.baseColor?.color ?? (comboColor?.on !== false ? comboColor?.paletteColor?.color : undefined);
  if (typeof color === "string" && HEX_COLOR.test(color)) out.color = color;
  const series = entry?.qDef?.series as { type?: unknown; axis?: unknown } | undefined;
  if (series && typeof series === "object" && SERIES_TYPES.includes(series.type as SeriesType)) {
    out.series = { type: series.type as SeriesType, axis: series.axis === 1 ? "secondary" : "primary" };
  }
  const target = entry?.qDef?.target;
  if (typeof target === "string" && target.trim() && target.trim() !== "=") out.target = target;
  const op = OPERATION_OF[String(entry?.qDef?.valueType)];
  if (op) out.operation = op;
  const subtotal = entry?.qDef?.subtotal as { enable?: unknown; label?: unknown } | undefined;
  if (subtotal?.enable === true) out.subtotal = typeof subtotal.label === "string" && subtotal.label.trim() ? subtotal.label : "Subtotal";
  return out;
}

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
