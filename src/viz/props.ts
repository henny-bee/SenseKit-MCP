// Property building entry point: normalize inputs, resolve options, then
// hand off to the chart type's own builder (viz/types/<type>.ts).

import { normalizeDims, normalizeMeasures, type DimInput, type MeasureInput } from "./inputs.js";
import { resolveVizOptions } from "./options.js";
import { buildCube } from "./build.js";
import { CHART_TYPES_BY_NAME } from "./types/index.js";
import type { VizOptions } from "./types/contract.js";
import type { GenericObjectProperties } from "../qix/types.js";

export { NEBULA_CHART_TYPES } from "./types/index.js";

/** Build the per-type object properties for createChild / setProperties.
 *  Dimensions/measures accept the original plain strings or spec objects;
 *  plain strings produce exactly the definitions the builder has always
 *  produced (and that were render-verified). */
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
  // Unknown types (extensions) get the generic straight cube.
  return CHART_TYPES_BY_NAME.get(viz)?.build(input) ?? buildCube(input);
}

/** One listbox child per filterpane dimension. Reuses the render-verified
 *  standalone listbox shape rather than inventing a second listbox def. */
export function buildFilterpaneChildren(dimensions: ReadonlyArray<DimInput>): GenericObjectProperties[] {
  return normalizeDims(dimensions).map((d) => buildVizProps("listbox", d.label ?? d.field ?? "", [d], []));
}
