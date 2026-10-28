import type { GenericObjectProperties } from "../../qix/types.js";
import type { DimSpec, MeasureSpec } from "../inputs.js";

export interface VizSpec {
  minDims: number; maxDims: number;
  minMeasures: number; maxMeasures: number;
  // filterpane: no cube of its own; one listbox child per dimension.
  cube: "hypercube" | "listobject" | "none" | "filterpane";
  pivot?: boolean; // qMode 'P' required — a straight cube renders empty
  /** false = not proven to paint in a browser client; absent = verified. */
  renderVerified?: boolean;
}

export type ColorMode = "auto" | "single" | "byDimension" | "byMeasure";

export interface VizOptions {
  colorMode?: ColorMode;
  color?: string;
  showLegend?: boolean;
  showDataLabels?: boolean;
  orientation?: "vertical" | "horizontal";
  stacked?: boolean;
  sortByMeasure?: "asc" | "desc";
  /** false = qSuppressZero ("Include zero values" unticked). */
  includeZeros?: boolean;
  navigateTo?: NavigateTo;
}

// Named exactly as the client stores navigation.action.
export const NAVIGATION_ACTIONS = ["none", "goToSheet", "nextSheet", "prevSheet", "firstSheet", "lastSheet", "openWebsite"] as const;
export type NavigationAction = typeof NAVIGATION_ACTIONS[number];

export interface NavigateTo {
  action: NavigationAction;
  sheetId?: string;
  url?: string;
  sameWindow?: boolean;
}

export type OptionKey = Exclude<keyof VizOptions, "color">;

export interface BuildInput {
  viz: string;
  title: string | undefined;
  base: GenericObjectProperties;
  dims: DimSpec[];
  meas: MeasureSpec[];
  applied: VizOptions;
  measureColors: boolean;
}

export interface ChartType {
  name: string;
  spec: VizSpec;
  minTile?: { colspan: number; rowspan: number };
  /** Gets NEBULA_DEFAULTS; the gate checks those blocks exist. */
  nebula?: boolean;
  options?: readonly OptionKey[];
  /** Absent = all four modes. */
  colorModes?: readonly ColorMode[];
  /** Returns why a shape fails that min/max ranges cannot express. */
  shapeRule?(nDims: number, nMeasures: number): string | undefined;
  measureColors?: boolean;
  build(input: BuildInput): GenericObjectProperties;
}
