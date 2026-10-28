import { HEX_COLOR, type DimSpec, type MeasureSpec } from "./inputs.js";
import { ToolError } from "../core/errors.js";
import { CHART_TYPES_BY_NAME } from "./types/index.js";
import type { NavigateTo, OptionKey, VizOptions } from "./types/contract.js";

export type { VizOptions } from "./types/contract.js";

// Order = the order ignored options are reported in.
const OPTION_KEYS: readonly OptionKey[] = ["colorMode", "showLegend", "showDataLabels", "orientation", "stacked", "sortByMeasure", "includeZeros", "navigateTo"];

const supports = (viz: string, key: OptionKey): boolean =>
  CHART_TYPES_BY_NAME.get(viz)?.options?.includes(key) ?? false;

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
  const modes = CHART_TYPES_BY_NAME.get(viz)?.colorModes;
  if (modes && applied.colorMode && !modes.includes(applied.colorMode)) {
    notes.push(`options.colorMode "${applied.colorMode}" does not apply to ${viz} (only ${modes.map((m) => `"${m}"`).join(" or ")}) — ignored`);
    delete applied.colorMode;
  }
  if (applied.navigateTo) checkNavigateTo(applied.navigateTo, notes);
  if (options.color !== undefined) {
    if (applied.colorMode === "single") applied.color = options.color;
    else if (supports(viz, "colorMode")) notes.push('options.color is only used with colorMode "single" — ignored');
    else notes.push(`options.color does not apply to ${viz} — ignored`);
  }
  // Unknown (extension) types get the generic hypercube, so cube flags apply.
  const spec = CHART_TYPES_BY_NAME.get(viz)?.spec;
  const hypercube = !spec || spec.cube === "hypercube";
  dims.forEach((d, i) => {
    if (d.libraryId && d.label !== undefined) {
      notes.push(`dimensions[${i}]: label ignored on a master dimension — the master item's own label is shown`);
    }
    if (d.includeNulls !== undefined && !hypercube) notes.push(`dimensions[${i}]: includeNulls does not apply to ${viz} — ignored`);
    if (d.pivotColumn !== undefined && viz !== "pivot-table") notes.push(`dimensions[${i}]: pivotColumn only applies to pivot-table — ignored`);
  });
  if (viz === "pivot-table") checkPivotColumns(dims);
  measures.forEach((m, i) => {
    if (m.libraryId && m.label !== undefined) {
      notes.push(`measures[${i}]: label ignored on a master measure — the master item's own label is shown`);
    }
    if (m.series !== undefined && viz !== "combochart") notes.push(`measures[${i}]: series only applies to combochart — ignored`);
    if (m.target !== undefined && viz !== "bulletchart") notes.push(`measures[${i}]: target only applies to bulletchart — ignored`);
    if (m.operation !== undefined && viz !== "waterfallchart") notes.push(`measures[${i}]: operation only applies to waterfallchart — ignored`);
    if (m.subtotal !== undefined && viz !== "waterfallchart") notes.push(`measures[${i}]: subtotal only applies to waterfallchart — ignored`);
    if (m.colorBands !== undefined && viz !== "kpi") notes.push(`measures[${i}]: colorBands only applies to kpi — ignored`);
  });
  let measureColors = false;
  if (measures.some((m) => m.color)) {
    if (CHART_TYPES_BY_NAME.get(viz)?.measureColors !== true) notes.push(`per-measure colors do not apply to ${viz} — ignored`);
    else if (applied.colorMode) notes.push(`per-measure colors ignored: options.colorMode "${applied.colorMode}" sets the chart's coloring`);
    else measureColors = true;
  }
  return { applied, notes, measureColors };
}

function checkNavigateTo(nav: NavigateTo, notes: string[]): void {
  if (nav.action === "goToSheet" && !nav.sheetId) {
    throw new ToolError("INVALID_INPUT", 'options.navigateTo action "goToSheet" needs sheetId (from list_sheets)');
  }
  if (nav.action === "openWebsite" && !(nav.url && /^(https?:\/\/|mailto:)/i.test(nav.url))) {
    throw new ToolError("INVALID_INPUT", 'options.navigateTo action "openWebsite" needs url starting with http://, https:// or mailto:');
  }
  if (nav.sheetId !== undefined && nav.action !== "goToSheet") notes.push(`options.navigateTo.sheetId only applies to action "goToSheet" — ignored`);
  if (nav.url !== undefined && nav.action !== "openWebsite") notes.push(`options.navigateTo.url only applies to action "openWebsite" — ignored`);
  if (nav.sameWindow !== undefined && nav.action !== "openWebsite") notes.push(`options.navigateTo.sameWindow only applies to action "openWebsite" — ignored`);
}

// qNoOfLeftDims counts LEADING dims as rows, so column dims must trail.
function checkPivotColumns(dims: DimSpec[]): void {
  const first = dims.findIndex((d) => d.pivotColumn === true);
  if (first === -1) return;
  if (first === 0) {
    throw new ToolError("INVALID_INPUT", "pivot-table needs at least one row dimension: dimensions[0] cannot be a pivotColumn");
  }
  const late = dims.findIndex((d, i) => i > first && d.pivotColumn !== true);
  if (late !== -1) {
    throw new ToolError("INVALID_INPUT", `pivot-table column dimensions must come after all row dimensions: dimensions[${first}] is a pivotColumn but dimensions[${late}] is not`);
  }
}
