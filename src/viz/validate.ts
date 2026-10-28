import type { QrsClient } from "../clients/qrs.js";
import { expressionWarnings, masterItems, type MasterKind } from "../qix/quality.js";
import { sheetList } from "../qix/objects.js";
import { TtlCache } from "../core/cache.js";
import { VIZ_SPECS, checkVizShape, type VizFinding } from "./specs.js";
import { noEq } from "./inputs.js";
import { cubeDefOf } from "./read-back.js";
import { NEBULA_CHART_TYPES } from "./props.js";
import type { Doc, GenericObject, GenericObjectProperties } from "../qix/types.js";

// ── Validation gate ──────────────────────────────────────────────────────────

/** Per-gate-run memo: each master list (measures, dimensions) is fetched at
 *  most once per call — and only if some object actually links to that kind
 *  — not once per object, when a sheet full of library-linked charts is
 *  checked. Safe under concurrent validation: the PROMISE is memoized. */
export interface GateContext {
  masterIds: (kind: MasterKind) => Promise<Map<string, string>>;
  /** The app's sheet ids, for buttons that navigate to a sheet. */
  sheetIds: () => Promise<Set<string>>;
}
export function gateContext(app: Doc): GateContext {
  const memo = new Map<MasterKind, Promise<Map<string, string>>>();
  let sheets: Promise<Set<string>> | undefined;
  return {
    sheetIds: () => (sheets ??= sheetList(app).then((l) => new Set(l.map((s) => s.sheetId)))),
    masterIds: (kind) => {
      let p = memo.get(kind);
      if (!p) {
        p = masterItems(app, [kind]).then((m) => (kind === "measure" ? m.measures : m.dimensions));
        memo.set(kind, p);
      }
      return p;
    },
  };
}

export type ObjectVerdict = {
  objectId: string; visualization?: string; title?: string;
  status: "pass" | "warn" | "fail"; findings: VizFinding[];
};

/** Validate one object's layout the way a renderer would consume it. */
/** Round trips a caller can save: `handle` when it already holds the object
 *  (it just created or rewrote it) skips getObject; `propsById` (from one
 *  GetFullPropertyTree of the sheet) skips getProperties for the object and
 *  any filterpane children. */
export interface PreFetched {
  handle?: GenericObject;
  propsById?: Map<string, GenericObjectProperties>;
}

export async function validateObject(
  app: Doc, objectId: string, knownViz: Set<string>, ctx: GateContext = gateContext(app), pre: PreFetched = {},
): Promise<ObjectVerdict> {
  const findings: VizFinding[] = [];
  let visualization: string | undefined;
  let title: string | undefined;
  try {
    const obj = pre.handle ?? await app.getObject(objectId);
    const prop = pre.propsById?.get(objectId) ?? await obj.getProperties();
    visualization = prop.visualization ?? prop.qInfo?.qType;
    title = typeof prop.title === "string" ? prop.title : prop.qMetaDef?.title;

    if (visualization && !knownViz.has(visualization)) {
      findings.push({ severity: "fail", message: `visualization "${visualization}" is neither a built-in nor an installed extension — renders as "Invalid visualization"` });
    }
    // A button whose target sheet was deleted (or never set) does nothing
    // when clicked; the engine has no opinion about it.
    const nav = prop.navigation;
    if (visualization === "action-button" && (nav?.action === "goToSheet" || nav?.action === "goToSheetById")) {
      if (typeof nav.sheet !== "string" || nav.sheet === "") {
        findings.push({ severity: "warn", message: `button navigation "${nav.action}" has no target sheet — clicking it does nothing` });
      } else if (!(await ctx.sheetIds()).has(nav.sheet)) {
        findings.push({ severity: "fail", message: `button navigates to sheet "${nav.sheet}", which does not exist in this app — clicking it does nothing` });
      }
    }
    const vspec = visualization ? VIZ_SPECS[visualization] : undefined;
    if (vspec && vspec.renderVerified === false) {
      findings.push({ severity: "warn", message: `${visualization} is not render-verified: the engine accepts it and it evaluates, but it has not been proven to paint in a browser client with generically-built properties — check it visually before shipping it to users` });
    }

    // A dangling qLibraryId persists without complaint and draws an error
    // tile. Checked against the app's master list rather than inferred from
    // qError, which the engine does not raise consistently for missing links.
    const cubeDef = cubeDefOf(prop);
    const links: Array<{ where: string; kind: "measure" | "dimension"; id: string }> = [];
    (cubeDef?.qDimensions ?? []).forEach((d, i) => { if (d?.qLibraryId) links.push({ where: `dimension ${i}`, kind: "dimension", id: d.qLibraryId }); });
    (cubeDef?.qMeasures ?? []).forEach((m, i) => { if (m?.qLibraryId) links.push({ where: `measure ${i}`, kind: "measure", id: m.qLibraryId }); });
    if (prop.qListObjectDef?.qLibraryId) links.push({ where: "listbox", kind: "dimension", id: prop.qListObjectDef.qLibraryId });
    for (const l of links) {
      if (!(await ctx.masterIds(l.kind)).has(l.id)) {
        findings.push({ severity: "fail", message: `${l.where} links to master ${l.kind} "${l.id}", which does not exist in this app — the client draws an error tile` });
      }
    }

    const layout = await obj.getLayout();
    const hc = layout.qHyperCube ?? layout.boxplotDef?.qHyperCube;
    if (hc) {
      (hc.qDimensionInfo ?? []).forEach((d, i) => {
        if (d.qError) findings.push({ severity: "fail", message: `dimension ${i} error qErrorCode=${d.qError.qErrorCode} (${d.qFallbackTitle ?? "?"}) — check the field name` });
      });
      (hc.qMeasureInfo ?? []).forEach((m, i) => {
        if (m.qError) findings.push({ severity: "fail", message: `measure ${i} error qErrorCode=${m.qError.qErrorCode} (${m.qFallbackTitle ?? "?"}) — check the expression` });
      });
      if (hc.qSize && hc.qSize.qcy === 0 && (hc.qDimensionInfo?.length || hc.qMeasureInfo?.length)) {
        findings.push({ severity: "warn", message: "hypercube computes but returns 0 rows — renders as an empty chart under current selections/data" });
      }
      // Nebula supernovas throw on missing default property blocks and render
      // BLANK while the engine reports a perfectly healthy hypercube. Verified
      // live: without these, 8 of 12 built-in types draw nothing.
      if (visualization && NEBULA_CHART_TYPES.has(visualization)) {
        const missing = ["color", "legend", "dataPoint", "gridLine", "tooltip"].filter((k) => prop[k] === undefined);
        if (missing.length) {
          findings.push({ severity: "fail", message: `${visualization} is nebula-rendered and is missing default property block(s): ${missing.join(", ")} — the engine computes it fine but the client throws and renders BLANK` });
        }
        const noCid = (cubeDef?.qMeasures ?? []).some((m) => !m.cId && !m.qDef?.cId);
        if (noCid) findings.push({ severity: "warn", message: "measures lack cId — some nebula charts need it for coloring/sorting" });
      }
      if (vspec?.pivot && hc.qMode !== "P" && hc.qMode !== "K") {
        findings.push({ severity: "fail", message: `pivot-table cube has qMode='${hc.qMode ?? "S"}' — must be 'P' (or 'K'); a straight cube renders an empty pivot` });
      }
      if (vspec && vspec.cube === "hypercube") {
        findings.push(...checkVizShape(visualization!, (hc.qDimensionInfo ?? []).length, (hc.qMeasureInfo ?? []).length));
      }
      // Expression-level validation on inline defs. Library-linked entries
      // carry no inline qDef.qDef / qFieldDefs and are skipped here — their
      // definitions live in the master item (covered by the link check).
      for (const [i, m] of (cubeDef?.qMeasures ?? []).entries()) {
        const def: string | undefined = m?.qLibraryId ? undefined : m?.qDef?.qDef;
        if (def) {
          for (const w of await expressionWarnings(app, noEq(def))) {
            findings.push({ severity: "fail", message: `measure ${i}: ${w}` });
          }
        }
      }
      for (const [i, d] of (cubeDef?.qDimensions ?? []).entries()) {
        const fd: unknown = d?.qLibraryId ? undefined : d?.qDef?.qFieldDefs?.[0];
        if (typeof fd === "string" && fd.startsWith("=")) {
          for (const w of await expressionWarnings(app, fd.slice(1))) {
            findings.push({ severity: "fail", message: `dimension ${i} (calculated): ${w}` });
          }
        }
      }
    }
    const lo = layout.qListObject;
    if (lo?.qDimensionInfo?.qError) {
      findings.push({ severity: "fail", message: `listobject field error qErrorCode=${lo.qDimensionInfo.qError.qErrorCode}` });
    }
    const loDef: unknown = prop.qListObjectDef?.qLibraryId ? undefined : prop.qListObjectDef?.qDef?.qFieldDefs?.[0];
    if (typeof loDef === "string" && loDef.startsWith("=")) {
      for (const w of await expressionWarnings(app, loDef.slice(1))) {
        findings.push({ severity: "fail", message: `listbox (calculated): ${w}` });
      }
    }

    if (vspec?.cube === "filterpane") {
      // A filterpane has no cube of its own — its data lives in its listbox
      // children, so validate those (field errors, dangling links) and lift
      // their findings onto the pane, which is what the sheet shows.
      const kids = await obj.getChildInfos();
      if (!kids.length) findings.push({ severity: "fail", message: "filterpane has no listbox children — it renders an empty frame" });
      for (const k of kids) {
        const r = await validateObject(app, k.qId, knownViz, ctx, { propsById: pre.propsById });
        for (const f of r.findings) {
          findings.push({ severity: f.severity, message: `listbox ${k.qId}${r.title ? ` "${r.title}"` : ""}: ${f.message}` });
        }
      }
    }
  } catch (e) {
    findings.push({ severity: "fail", message: `object unreadable: ${e instanceof Error ? e.message : String(e)}` });
  }
  const status = findings.some((f) => f.severity === "fail") ? "fail" : findings.length ? "warn" : "pass";
  return { objectId, visualization, title, status, findings };
}

// Sense client built-ins beyond the builder's supported set.
const CLIENT_BUILTINS = ["filterpane", "map", "histogram", "waterfallchart", "boxplot", "distributionplot", "mekkochart", "bulletchart", "sn-grid-chart", "action-button", "container", "qlik-word-cloud"];

/** Installed extensions change on a deploy, not between two tool calls: one
 *  QRS round trip per site per 5 minutes instead of one per validation. */
const EXTENSION_TTL_MS = 5 * 60_000;
const extensionCache = new TtlCache<string, string[]>(EXTENSION_TTL_MS);

/** Built-ins + installed extensions. `siteKey` (the QSEoW host) keys the
 *  extension cache, so two sites never share a list. A failed QRS lookup is
 *  not cached: it falls back to built-ins only for this call. */
export async function knownVisualizations(qrs: QrsClient, siteKey: string): Promise<Set<string>> {
  const known = new Set(Object.keys(VIZ_SPECS));
  for (const v of CLIENT_BUILTINS) known.add(v);
  try {
    const ext = await extensionCache.get(siteKey, async () =>
      (await qrs.get<Array<{ name: string }>>("/qrs/extension/full")).map((e) => e.name));
    for (const name of ext) known.add(name);
  } catch { /* extensions unavailable (e.g. narrow identity) — built-ins only */ }
  return known;
}
