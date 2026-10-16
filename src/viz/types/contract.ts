// The contract every chart type implements. One file per type under
// viz/types/, registered in viz/types/index.ts: shape limits, cube kind, tile
// size, which styling options it honours, and its property builder.

import type { GenericObjectProperties } from "../../qix/types.js";
import type { DimSpec, MeasureSpec } from "../inputs.js";

// ── Visualization shape specs (builder + validation gate) ────────────────────
// What each built-in visualization needs to actually render. Derived from the
// object model and verified against a live engine by scripts/viz_matrix.mjs —
// a shape the engine accepts but the client renders blank is exactly the bug
// class the validation gate exists to catch.

export interface VizSpec {
  minDims: number; maxDims: number;
  minMeasures: number; maxMeasures: number;
  // filterpane: a container with no data cube of its own — one listbox child
  // per dimension, each with its own qListObjectDef.
  cube: "hypercube" | "listobject" | "none" | "filterpane";
  pivot?: boolean; // qMode 'P' required — a straight cube renders empty
  /** false = the built object has NOT been proven to paint pixels in a real
   *  browser client (see scripts/viz_matrix.mjs + the headless render proof).
   *  Absent means verified. */
  renderVerified?: boolean;
}

// ── Styling options ──────────────────────────────────────────────────────────
// Chart-level styling an agent can ask for. Each option is applied only to
// the types whose supernova reads the block it writes; anything else is
// dropped and REPORTED (notes), never silently swallowed — an agent that asked
// for a legend on a KPI should hear that it got none.
//
// NOT render-verified: these blocks follow the client's documented property
// shapes but have not yet been through scripts/render_proof.mjs.
export interface VizOptions {
  colorMode?: "auto" | "single" | "byDimension" | "byMeasure";
  color?: string;
  showLegend?: boolean;
  showDataLabels?: boolean;
  orientation?: "vertical" | "horizontal";
  stacked?: boolean;
  sortByMeasure?: "asc" | "desc";
  /** false = the client's "Include zero values" unticked (qSuppressZero). */
  includeZeros?: boolean;
}

/** Option keys a chart type can honour (`color` follows `colorMode`). */
export type OptionKey = Exclude<keyof VizOptions, "color">;

/** Everything a builder gets: normalized specs, the options already filtered
 *  to this type, and the base props ({ qInfo, visualization, title }). */
export interface BuildInput {
  viz: string;
  title: string | undefined;
  base: GenericObjectProperties;
  dims: DimSpec[];
  meas: MeasureSpec[];
  applied: VizOptions;
  measureColors: boolean;
}

/** One chart type. Adding a type = one file exporting this, plus one line in
 *  viz/types/index.ts (registry order is the order tools list types in). */
export interface ChartType {
  name: string;
  spec: VizSpec;
  /** Smallest auto-placed tile the type draws in (default 8x4). */
  minTile?: { colspan: number; rowspan: number };
  /** Rendered by a nebula.js supernova: gets NEBULA_DEFAULTS, and the gate
   *  checks for those blocks. */
  nebula?: boolean;
  /** Styling options this type honours; anything else is reported as ignored. */
  options?: readonly OptionKey[];
  /** Per-measure colors (qDef.coloring.baseColor) are meaningful. */
  measureColors?: boolean;
  build(input: BuildInput): GenericObjectProperties;
}
