// Pre-flight + creation of a visualization definition, shared by
// add_sheet_object and update_sheet_object.

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

/** Normalize and pre-flight a definition: everything that can be refused
 *  BEFORE the app is touched, rather than persisting junk and reporting it. */
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

  // A button that goes to a sheet that isn't there saves fine and does
  // nothing when clicked.
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
  // A calculated dimension is refused on ANY CheckExpression finding — same
  // bar as a misspelled field dimension. An inline measure only on a hard
  // syntax error: an unknown field in a measure saves and renders 0, which
  // is exactly what the post-create gate reports as a fail (the builder demo
  // relies on that path), so it is not pre-empted here.
  // All CheckExpression calls go out together (bounded); refusals are then
  // raised in input order, dimensions first — the same first error a
  // sequential walk would report.
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

/** Create the object under `parent` (a sheet), plus its listbox children
 *  when it is a filterpane. Returns the new object id. */
export async function createVizObject(
  parent: GenericObject, viz: string, prepared: PreparedDefinition,
): Promise<{ objectId: string; handle: GenericObject }> {
  const child = await parent.createChild(prepared.props);
  if (VIZ_SPECS[viz]?.cube === "filterpane") {
    for (const lb of buildFilterpaneChildren(prepared.dims)) await child.createChild(lb);
  }
  // The handle is returned so the caller can validate without a getObject.
  return { objectId: (await child.getLayout()).qInfo.qId, handle: child };
}
