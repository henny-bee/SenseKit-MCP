// Shape specs per visualization type, derived from the chart-type registry
// (viz/types/). Kept as a flat record because the gate, the tool
// descriptions and the tests all read it by name.

import { CHART_TYPES, CHART_TYPES_BY_NAME } from "./types/index.js";
import type { VizSpec } from "./types/contract.js";

export type { VizSpec } from "./types/contract.js";

export const VIZ_SPECS: Record<string, VizSpec> = Object.fromEntries(CHART_TYPES.map((t) => [t.name, t.spec]));

export interface VizFinding { severity: "fail" | "warn"; message: string }

/** Shape check for a visualization request; empty result = shape is fine. */
export function checkVizShape(viz: string, nDims: number, nMeasures: number): VizFinding[] {
  const spec = VIZ_SPECS[viz];
  if (!spec) {
    return [{ severity: "warn", message: `unknown visualization type "${viz}" — not a known built-in; will render only if a matching extension is installed` }];
  }
  const out: VizFinding[] = [];
  if (nDims < spec.minDims || nDims > spec.maxDims) {
    out.push({ severity: "fail", message: `${viz} needs ${spec.minDims}-${spec.maxDims} dimensions, got ${nDims}` });
  }
  if (nMeasures < spec.minMeasures || nMeasures > spec.maxMeasures) {
    out.push({ severity: "fail", message: `${viz} needs ${spec.minMeasures}-${spec.maxMeasures} measures, got ${nMeasures}` });
  }
  const rule = out.length ? undefined : CHART_TYPES_BY_NAME.get(viz)?.shapeRule?.(nDims, nMeasures);
  if (rule) out.push({ severity: "fail", message: rule });
  return out;
}
