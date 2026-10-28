import type { NxNumFormat } from "../qix/types.js";
import { ToolError } from "../core/errors.js";

export type NumberFormatType = "auto" | "number" | "integer" | "percent" | "money" | "date" | "custom";
export interface NumberFormatSpec { type: NumberFormatType; pattern?: string; decimals?: number }

export interface EngineNumFormat {
  qNumFormat: { qType: string; qFmt: string; qnDec: number; qUseThou: 0 | 1; qDec: string; qThou: string };
  numFormatFromTemplate: false;
  isCustomFormatted?: true;
}

const decimalsIn = (pattern: string) => /\.([0#]+)/.exec(pattern.split(";")[0])?.[1].length ?? 0;
const frac = (n: number) => (n > 0 ? "." + "0".repeat(n) : "");

// numFormatFromTemplate must be false or the client ignores qNumFormat.
// Separators pinned to "." / "," so patterns read the same in any app locale.
export function numFormatToEngine(nf: NumberFormatSpec): EngineNumFormat | undefined {
  const dec = nf.decimals;
  if (dec !== undefined && (!Number.isInteger(dec) || dec < 0 || dec > 15)) {
    throw new ToolError("INVALID_INPUT", `numberFormat.decimals must be an integer 0-15, got ${dec}`);
  }
  if (nf.pattern !== undefined && !nf.pattern.trim()) throw new ToolError("INVALID_INPUT", "numberFormat.pattern must not be empty");
  let qType: string, qFmt: string, qnDec: number;
  switch (nf.type) {
    case "auto": return undefined;
    case "number":  qType = "F"; qnDec = dec ?? 2; qFmt = nf.pattern ?? `#,##0${frac(qnDec)}`; break;
    case "integer": qType = "I"; qnDec = 0;        qFmt = nf.pattern ?? "#,##0"; break;
    case "percent": qType = "F"; qnDec = dec ?? 1; qFmt = nf.pattern ?? `0${frac(qnDec)}%`; break;
    case "money":   qType = "M"; qnDec = dec ?? 2; qFmt = nf.pattern ?? `$#,##0${frac(qnDec)};-$#,##0${frac(qnDec)}`; break;
    case "date":    qType = "D"; qnDec = 0;        qFmt = nf.pattern ?? "YYYY-MM-DD"; break;
    case "custom":
      if (!nf.pattern) throw new ToolError("INVALID_INPUT", 'numberFormat.type "custom" needs a pattern, e.g. "#,##0.0 \'units\'"');
      qType = "R"; qnDec = dec ?? decimalsIn(nf.pattern); qFmt = nf.pattern; break;
    default:
      throw new ToolError("INVALID_INPUT", `unknown numberFormat.type "${String((nf as { type?: unknown }).type)}"`);
  }
  const useThou = qType !== "D" && qFmt.split(";")[0].includes(",");
  return {
    qNumFormat: { qType, qFmt, qnDec, qUseThou: useThou ? 1 : 0, qDec: ".", qThou: "," },
    numFormatFromTemplate: false,
    ...(nf.type === "custom" ? { isCustomFormatted: true as const } : {}),
  };
}

export function numberFormatFromEngine(
  qDef: { qNumFormat?: NxNumFormat; numFormatFromTemplate?: boolean; isCustomFormatted?: boolean } | undefined,
): NumberFormatSpec | undefined {
  const nf = qDef?.qNumFormat;
  if (!qDef || qDef.numFormatFromTemplate !== false || !nf || !nf.qType || nf.qType === "U" || !nf.qFmt) return undefined;
  const base = { pattern: String(nf.qFmt), ...(typeof nf.qnDec === "number" ? { decimals: nf.qnDec } : {}) };
  if (qDef.isCustomFormatted) return { type: "custom", ...base };
  switch (nf.qType) {
    case "I": return { type: "integer", pattern: base.pattern };
    case "M": return { type: "money", ...base };
    case "D": return { type: "date", pattern: base.pattern };
    case "F": return { type: base.pattern.includes("%") ? "percent" : "number", ...base };
    default:  return { type: "custom", ...base };
  }
}
