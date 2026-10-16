// Engine-side quality checks shared by the analytics tools (trust envelope)
// and the builder/validation gate. Everything here is read-only.
import type { Doc } from "./types.js";

/** Prefix of an expressionWarnings entry that is a hard syntax/parse error
 *  (as opposed to an unknown-field warning, which still evaluates — to 0). */
export const EXPRESSION_ERROR = "expression error:";

/** Validate an expression with the engine BEFORE trusting its result.
 *  Catches the silent killers: a misspelled field does not error at evaluate
 *  time — it just makes the number wrong. */
export async function expressionWarnings(app: Doc, expression: string): Promise<string[]> {
  const warnings: string[] = [];
  try {
    const chk = await app.checkExpression(expression);
    if (chk.qErrorMsg) warnings.push(`${EXPRESSION_ERROR} ${chk.qErrorMsg}`);
    const bad = badFieldSubstrings(expression, chk.qBadFieldNames ?? []);
    if (bad.length) warnings.push(`unknown field(s): ${bad.join(", ")} — the engine returns null/0 for these rather than erroring`);
  } catch { /* CheckExpression unavailable — do not block evaluation */ }
  return warnings;
}

/** Current selection state, compactly. Stamped onto every analytics return so
 *  a number can never silently masquerade as the unfiltered truth. */
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

/** Field names present in the app's data model (for dimension validation). */
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

/** The app's master measures and dimensions (id -> title). Used to refuse a
 *  qLibraryId that points nowhere: the engine persists a dangling link
 *  without complaint and the client draws an error tile. */
export type MasterKind = "measure" | "dimension";

/**
 *  Each kind costs three round trips (create, layout, destroy), so callers
 *  that only need one kind ask for just that one; the other map stays empty. */
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

/** Map engine CheckExpression qBadFieldNames ranges ({qFrom,qCount} into the
 *  expression string) to the offending substrings. */
export function badFieldSubstrings(expression: string, ranges: Array<{ qFrom: number; qCount: number }>): string[] {
  return (ranges ?? []).map((r) => expression.slice(r.qFrom, r.qFrom + r.qCount));
}

/** Case-insensitive title clash: two master items that differ only in case
 *  are indistinguishable in the client's asset panel. */
export function titleTaken(items: Map<string, string>, title: string): string | undefined {
  const want = title.trim().toLowerCase();
  for (const [id, t] of items) if (t.trim().toLowerCase() === want) return id;
  return undefined;
}
