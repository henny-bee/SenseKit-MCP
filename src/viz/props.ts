import { normalizeDims, normalizeMeasures, type DimInput, type MeasureInput } from "./inputs.js";
import { resolveVizOptions } from "./options.js";
import { buildCube } from "./build.js";
import { CHART_TYPES_BY_NAME } from "./types/index.js";
import type { VizOptions } from "./types/contract.js";
import type { GenericObjectProperties } from "../qix/types.js";

export { NEBULA_CHART_TYPES } from "./types/index.js";

export function buildVizProps(
  viz: string,
  title: string | undefined,
  dimensions: ReadonlyArray<DimInput>,
  measures: ReadonlyArray<MeasureInput>,
  options: VizOptions = {},
): GenericObjectProperties {
  const dims = normalizeDims(dimensions);
  const meas = normalizeMeasures(measures);
  const { applied, measureColors } = resolveVizOptions(viz, options, dims, meas);
  const base: GenericObjectProperties = { qInfo: { qType: viz }, visualization: viz, title: title ?? "" };
  const input = { viz, title, base, dims, meas, applied, measureColors };
  return CHART_TYPES_BY_NAME.get(viz)?.build(input) ?? buildCube(input);
}

export function buildFilterpaneChildren(dimensions: ReadonlyArray<DimInput>): GenericObjectProperties[] {
  return normalizeDims(dimensions).map((d) => buildVizProps("listbox", d.label ?? d.field ?? "", [d], []));
}
