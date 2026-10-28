import { errMsg, ToolError, type ErrorCode } from "../core/errors.js";
import { mapPool, ENGINE_CONCURRENCY } from "../core/pool.js";
import { expressionWarnings, fieldNames, masterItems, EXPRESSION_ERROR } from "../qix/quality.js";
import { sheetList } from "../qix/objects.js";
import { VIZ_SPECS, checkVizShape } from "./specs.js";
import {
  normalizeDims, normalizeMeasures, noEq,
  type DimSpec, type DimInput, type MeasureSpec, type MeasureInput,
} from "./inputs.js";
import { resolveVizOptions, type VizOptions } from "./options.js";
import { buildVizProps, buildFilterpaneChildren } from "./props.js";
import type { Doc, GenericObject, GenericObjectProperties } from "../qix/types.js";

export interface PreparedDefinition { props: GenericObjectProperties; dims: DimSpec[]; notes: string[] }

export async function prepareDefinition(
  app: Doc,
  verb: "create" | "update",
  viz: string,
  title: string | undefined,
  dimensions: ReadonlyArray<DimInput>,
  measures: ReadonlyArray<MeasureInput>,
  options: VizOptions | undefined,
): Promise<PreparedDefinition> {
  const refuse = (why: string, code: ErrorCode = "VALIDATION_REFUSED", details?: Record<string, unknown>) =>
    new ToolError(code, `refusing to ${verb}: ${why}`, details);
  let dims: DimSpec[];
  let meas: MeasureSpec[];
  let resolved: ReturnType<typeof resolveVizOptions>;
  try {
    dims = normalizeDims(dimensions);
    meas = normalizeMeasures(measures);
    resolved = resolveVizOptions(viz, options ?? {}, dims, meas);
  } catch (e) {
    throw refuse(errMsg(e), "INVALID_INPUT");
  }
  const hardShape = checkVizShape(viz, dims.length, meas.length).filter((f) => f.severity === "fail");
  if (hardShape.length) throw refuse(hardShape.map((f) => f.message).join("; "), "VALIDATION_REFUSED", { visualization: viz, findings: hardShape });

  // A goToSheet to a missing sheet saves fine and silently does nothing.
  const nav = resolved.applied.navigateTo;
  if (nav?.action === "goToSheet" && nav.sheetId) {
    const sheets = await sheetList(app);
    if (!sheets.some((s) => s.sheetId === nav.sheetId)) {
      throw refuse(`navigateTo sheet "${nav.sheetId}" does not exist in this app`, "NOT_FOUND", { sheetId: nav.sheetId });
    }
  }

  const fieldDims = dims.flatMap((d) => (d.field !== undefined ? [d.field] : []));
  if (fieldDims.length) {
    const fields = await fieldNames(app);
    const missing = fieldDims.filter((f) => !fields.has(f));
    if (missing.length) throw refuse(`dimension field(s) not in the data model: ${missing.join(", ")}`, "NOT_FOUND", { missingFields: missing });
  }
  // Measures refuse only syntax errors: an unknown field renders 0 and the gate fails it.
  // Refusals are raised in input order, dimensions first.
  const [dimWarnings, measWarnings] = await Promise.all([
    mapPool(dims, ENGINE_CONCURRENCY, (d) => (d.expression === undefined ? Promise.resolve([]) : expressionWarnings(app, d.expression.slice(1)))),
    mapPool(meas, ENGINE_CONCURRENCY, (m) => (m.expression === undefined ? Promise.resolve([]) : expressionWarnings(app, noEq(m.expression)))),
  ]);
  for (const [i, d] of dims.entries()) {
    const w = dimWarnings[i];
    if (w.length) throw refuse(`dimensions[${i}] ${d.expression}: ${w.join("; ")}`, "VALIDATION_REFUSED", { dimension: i, expression: d.expression, warnings: w });
  }
  for (const [i, m] of meas.entries()) {
    const errs = measWarnings[i].filter((w) => w.startsWith(EXPRESSION_ERROR));
    if (errs.length) throw refuse(`measures[${i}] ${m.expression}: ${errs.join("; ")}`, "VALIDATION_REFUSED", { measure: i, expression: m.expression, errors: errs });
  }
  const dimLinks = dims.flatMap((d) => (d.libraryId ? [d.libraryId] : []));
  const measLinks = meas.flatMap((m) => (m.libraryId ? [m.libraryId] : []));
  if (dimLinks.length || measLinks.length) {
    const masters = await masterItems(app, [
      ...(measLinks.length ? ["measure" as const] : []), ...(dimLinks.length ? ["dimension" as const] : []),
    ]);
    const badDims = dimLinks.filter((id) => !masters.dimensions.has(id));
    const badMeas = measLinks.filter((id) => !masters.measures.has(id));
    if (badDims.length) throw refuse(`master dimension id(s) not found in this app: ${badDims.join(", ")}`, "NOT_FOUND", { masterDimensionIds: badDims });
    if (badMeas.length) throw refuse(`master measure id(s) not found in this app: ${badMeas.join(", ")}`, "NOT_FOUND", { masterMeasureIds: badMeas });
  }
  return { props: buildVizProps(viz, title, dims, meas, resolved.applied), dims, notes: resolved.notes };
}

export async function createVizObject(
  parent: GenericObject, viz: string, prepared: PreparedDefinition,
): Promise<{ objectId: string; handle: GenericObject }> {
  const child = await parent.createChild(prepared.props);
  if (VIZ_SPECS[viz]?.cube === "filterpane") {
    for (const lb of buildFilterpaneChildren(prepared.dims)) await child.createChild(lb);
  }
  return { objectId: (await child.getLayout()).qInfo.qId, handle: child };
}
