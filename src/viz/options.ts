import { HEX_COLOR, type DimSpec, type MeasureSpec } from "./inputs.js";
import { ToolError } from "../core/errors.js";
import { CHART_TYPES_BY_NAME } from "./types/index.js";
import type { OptionKey, VizOptions } from "./types/contract.js";

export type { VizOptions } from "./types/contract.js";

// Which type honours which option is declared on the type itself
// (ChartType.options / .measureColors). This is the order ignored options
// are reported in.
const OPTION_KEYS: readonly OptionKey[] = ["colorMode", "showLegend", "showDataLabels", "orientation", "stacked", "sortByMeasure"];

const supports = (viz: string, key: OptionKey): boolean =>
  CHART_TYPES_BY_NAME.get(viz)?.options?.includes(key) ?? false;

/** Decide which options apply to this type. Pure; throws on contradictory
 *  input (single color without a color). `notes` lists everything ignored. */
export function resolveVizOptions(
  viz: string,
  options: VizOptions,
  dims: DimSpec[],
  measures: MeasureSpec[],
): { applied: VizOptions; notes: string[]; measureColors: boolean } {
  const notes: string[] = [];
  const applied: VizOptions = {};
  if (options.color !== undefined && !HEX_COLOR.test(options.color)) {
    throw new ToolError("INVALID_INPUT", `options.color must be a hex color like #1f77b4, got "${options.color}"`);
  }
  if (options.colorMode === "single" && !options.color) {
    throw new ToolError("INVALID_INPUT", 'options.colorMode "single" needs options.color (a hex color)');
  }
  let colorMode = options.colorMode;
  if (options.color !== undefined && colorMode === undefined && supports(viz, "colorMode")) {
    colorMode = "single";
    notes.push('options.color given without colorMode — applied as colorMode "single"');
  }
  const requested: VizOptions = { ...options, colorMode };
  for (const key of OPTION_KEYS) {
    if (requested[key] === undefined) continue;
    if (!supports(viz, key)) {
      notes.push(`options.${key} does not apply to ${viz} — ignored`);
      continue;
    }
    (applied as Record<string, unknown>)[key] = requested[key];
  }
  if (options.color !== undefined) {
    if (applied.colorMode === "single") applied.color = options.color;
    else if (supports(viz, "colorMode")) notes.push('options.color is only used with colorMode "single" — ignored');
    else notes.push(`options.color does not apply to ${viz} — ignored`);
  }
  dims.forEach((d, i) => {
    if (d.libraryId && d.label !== undefined) {
      notes.push(`dimensions[${i}]: label ignored on a master dimension — the master item's own label is shown`);
    }
  });
  measures.forEach((m, i) => {
    if (m.libraryId && m.label !== undefined) {
      notes.push(`measures[${i}]: label ignored on a master measure — the master item's own label is shown`);
    }
  });
  let measureColors = false;
  if (measures.some((m) => m.color)) {
    if (CHART_TYPES_BY_NAME.get(viz)?.measureColors !== true) notes.push(`per-measure colors do not apply to ${viz} — ignored`);
    else if (applied.colorMode) notes.push(`per-measure colors ignored: options.colorMode "${applied.colorMode}" sets the chart's coloring`);
    else measureColors = true;
  }
  return { applied, notes, measureColors };
}
