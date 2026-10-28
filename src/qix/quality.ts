import type { Doc } from "./types.js";

/** Hard parse error; unknown-field warnings still evaluate (to 0). */
export const EXPRESSION_ERROR = "expression error:";

// A misspelled field does not error at evaluate time; it silently yields 0.
export async function expressionWarnings(app: Doc, expression: string): Promise<string[]> {
  const warnings: string[] = [];
  try {
    const chk = await app.checkExpression(expression);
    if (chk.qErrorMsg) warnings.push(`${EXPRESSION_ERROR} ${chk.qErrorMsg}`);
    const bad = badFieldSubstrings(expression, chk.qBadFieldNames ?? []);
    if (bad.length) warnings.push(`unknown field(s): ${bad.join(", ")} — the engine returns null/0 for these rather than erroring`);
  } catch { /* CheckExpression unavailable: do not block evaluation */ }
  return warnings;
}

export async function activeSelections(app: Doc): Promise<Array<{ field: string; selectedCount: number; selected?: string }>> {
  const obj = await app.createSessionObject({
    qInfo: { qType: "mcp-selection-context" },
    qSelectionObjectDef: {},
  });
  try {
    const layout = await obj.getLayout();
    return (layout.qSelectionObject?.qSelections ?? []).map((s) => ({
      field: s.qField, selectedCount: s.qSelectedCount, selected: s.qSelected,
    }));
  } finally {
    await app.destroySessionObject(obj.id).catch(() => {});
  }
}

export async function fieldNames(app: Doc): Promise<Set<string>> {
  const obj = await app.createSessionObject({
    qInfo: { qType: "mcp-fieldlist" },
    qFieldListDef: { qShowSystem: false, qShowHidden: false, qShowSemantic: true },
  });
  try {
    const layout = await obj.getLayout();
    return new Set((layout.qFieldList?.qItems ?? []).map((f) => f.qName));
  } finally {
    await app.destroySessionObject(obj.id).catch(() => {});
  }
}

export interface MasterIndex {
  /** id -> title */
  measures: Map<string, string>;
  dimensions: Map<string, string>;
}

export type MasterKind = "measure" | "dimension";

// Three round trips per kind: ask only for the kinds you need.
export async function masterItems(app: Doc, kinds: readonly MasterKind[] = ["measure", "dimension"]): Promise<MasterIndex> {
  const out: MasterIndex = { measures: new Map(), dimensions: new Map() };
  const lists: Array<[Record<string, unknown>, "qMeasureList" | "qDimensionList", Map<string, string>]> = [];
  if (kinds.includes("measure")) lists.push([{ qMeasureListDef: { qType: "measure", qData: {} } }, "qMeasureList", out.measures]);
  if (kinds.includes("dimension")) lists.push([{ qDimensionListDef: { qType: "dimension", qData: {} } }, "qDimensionList", out.dimensions]);
  for (const [def, key, map] of lists) {
    const obj = await app.createSessionObject({ qInfo: { qType: `mcp-master-${key}` }, ...def });
    try {
      const layout = await obj.getLayout();
      for (const it of layout[key]?.qItems ?? []) map.set(it.qInfo.qId, it.qMeta?.title ?? "");
    } finally {
      await app.destroySessionObject(obj.id).catch(() => {});
    }
  }
  return out;
}

export function badFieldSubstrings(expression: string, ranges: Array<{ qFrom: number; qCount: number }>): string[] {
  return (ranges ?? []).map((r) => expression.slice(r.qFrom, r.qFrom + r.qCount));
}

// Case-insensitive: the client's asset panel cannot tell case variants apart.
export function titleTaken(items: Map<string, string>, title: string): string | undefined {
  const want = title.trim().toLowerCase();
  for (const [id, t] of items) if (t.trim().toLowerCase() === want) return id;
  return undefined;
}
