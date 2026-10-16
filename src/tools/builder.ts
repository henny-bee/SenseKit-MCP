import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EngineClient } from "../clients/engine.js";
import type { QrsClient } from "../clients/qrs.js";
import type { Config } from "../config.js";
import { text } from "../core/result.js";
import { READ } from "../core/annotations.js";
import { errMsg, ToolError } from "../core/errors.js";
import { guid } from "../core/schemas.js";
import { redactSecrets } from "../core/redact.js";
import { VIZ_SPECS } from "../viz/specs.js";
import type { DimInput, MeasureInput } from "../viz/inputs.js";
import { positionSchema, dimensionInputSchema, measureInputSchema, vizOptionsSchema } from "../viz/schemas.js";
import { buildFilterpaneChildren } from "../viz/props.js";
import { cubeDimSpecs, dimSpecFromDef, measureSpecFromDef, specsFromProps } from "../viz/read-back.js";
import { checkCellPlacement, cellBox, placeCell, placementFor } from "../viz/layout.js";
import { validateObject, knownVisualizations, gateContext } from "../viz/validate.js";
import { prepareDefinition, createVizObject } from "../viz/definition.js";
import { mapPool, ENGINE_CONCURRENCY } from "../core/pool.js";
import { requireChildOf, indexPropertyTree } from "../qix/objects.js";
import { saveApp } from "../qix/save.js";
import type { KeyedLock } from "../core/lock.js";

// The UI-builder layer: create sheets and visualization objects, and — the
// part that makes it shippable — a validation gate that checks what the
// engine ACCEPTED will actually render. The engine happily persists a def the
// client draws as a blank tile; "saved" and "renders" are different claims.

const dimensionsParam = z.array(dimensionInputSchema).optional()
  .describe("Field names, or objects {field|expression|libraryId, label?, sort?, includeNulls?, pivotColumn?} — exactly one of field/expression ('=Year(Date)', a calculated dimension)/libraryId (master dimension)");
const measuresParam = z.array(measureInputSchema).optional()
  .describe("Expressions, e.g. 'Sum(Sales)', or objects {expression|libraryId, label?, numberFormat?, color?, series?} — exactly one of expression/libraryId (master measure)");
const optionsParam = vizOptionsSchema.optional()
  .describe("Styling: colorMode/color, showLegend, showDataLabels, orientation + stacked (barchart), sortByMeasure, includeZeros. Options that don't apply to the type are ignored and listed in the response's notes. NOT yet render-verified.");

export function registerBuilderTools(server: McpServer, engine: EngineClient, qrs: QrsClient, cfg: Config, writes: KeyedLock): void {
  server.registerTool(
    "validate_sheet",
    {
      description:
        "Quality gate for the UI layer: validate that a sheet's objects (or one object) will actually render — " +
        "definition errors, unknown/missing visualization types, unknown fields in expressions, empty-data cubes, " +
        "pivot qMode traps, dangling master-item links, filterpane listbox children, and cell-placement problems " +
        "(unplaced objects, orphan cells, off-grid, overlaps). " +
        "The engine accepts definitions the client draws blank; this catches those before a user does.",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        sheetId: z.string().optional().describe("Sheet to validate (all placed objects + placement lint)"),
        objectId: z.string().optional().describe("Single object to validate (placement lint skipped)"),
      },
      annotations: { ...READ, idempotentHint: true },
    },
    async ({ appId, sheetId, objectId }) => {
      if (!sheetId && !objectId) throw new ToolError("INVALID_INPUT", "Provide sheetId or objectId");
      const app = await engine.app(appId);
      if (objectId) {
        const known = await knownVisualizations(qrs, cfg.host);
        return text(redactSecrets(await validateObject(app, objectId, known)));
      }
      const sheet = await app.getObject(sheetId!);
      // Independent reads, issued together. One GetFullPropertyTree returns
      // the sheet's properties AND every object's below it, so the per-object
      // validation needs no getProperties round trip of its own.
      const [known, tree, childInfos] = await Promise.all([
        knownVisualizations(qrs, cfg.host), sheet.getFullPropertyTree().catch(() => undefined), sheet.getChildInfos(),
      ]);
      const props = tree?.qProperty ?? await sheet.getProperties();
      const propsById = tree ? indexPropertyTree(tree) : undefined;
      const children = childInfos.map((c) => c.qId);
      const cells = (props.cells ?? []).map(cellBox);
      const placement = checkCellPlacement(cells, children, props.columns ?? 24, props.rows ?? 12);
      const ctx = gateContext(app);
      // Objects validate concurrently (bounded); mapPool keeps sheet order.
      const objects = await mapPool(children, ENGINE_CONCURRENCY, (id) => validateObject(app, id, known, ctx, { propsById }));
      const failing = objects.filter((o) => o.status === "fail").length + placement.filter((f) => f.severity === "fail").length;
      return text(redactSecrets({
        sheetId,
        grid: { columns: props.columns ?? 24, rows: props.rows ?? 12 },
        objectCount: children.length,
        verdict: failing ? "FAIL" : (placement.length || objects.some((o) => o.status === "warn")) ? "WARN" : "PASS",
        placementFindings: placement,
        objects,
      }));
    },
  );

  if (!cfg.allowMutations) return;

  server.registerTool(
    "create_sheet",
    {
      description: "Create an empty sheet in an app. Returns the sheet id. MUTATION (additive).",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        title: z.string().describe("Sheet title"),
        description: z.string().optional(),
        columns: z.number().int().positive().max(48).optional().describe("Grid columns (default 24)"),
        rows: z.number().int().positive().max(24).optional().describe("Grid rows (default 12)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    writes.byApp(async ({ appId, title, description, columns, rows }) => {
      const app = await engine.app(appId);
      const sheet = await app.createObject({
        qInfo: { qType: "sheet" },
        qMetaDef: { title, description: description ?? "" },
        columns: columns ?? 24,
        rows: rows ?? 12,
        cells: [],
        qChildListDef: { qData: { title: "/title" } },
      });
      const sheetId = (await sheet.getLayout()).qInfo.qId;
      await saveApp(app);
      return text({ sheetId, title, grid: { columns: columns ?? 24, rows: rows ?? 12 } });
    }),
  );

  server.registerTool(
    "add_sheet_object",
    {
      description:
        "Add a visualization to a sheet and IMMEDIATELY run the render-validation gate on it — creation and " +
        "quality check in one call; the response's validation.status tells you whether it will actually render. " +
        `Supported types: ${Object.keys(VIZ_SPECS).join(", ")}. Dimensions are field names, calculated ` +
        "dimensions or master dimensions; measures are expressions or master measures, with optional label, " +
        "number format and color. A filterpane gets one listbox per dimension. Refuses unknown fields, " +
        "calculated-dimension errors, measure syntax errors and unknown master ids BEFORE creating. MUTATION (additive).",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        sheetId: z.string().describe("Sheet id (from create_sheet or list_sheets)"),
        visualization: z.string().describe("Visualization type, e.g. 'barchart'"),
        title: z.string().optional(),
        dimensions: dimensionsParam,
        measures: measuresParam,
        options: optionsParam,
        position: positionSchema.optional().describe("Omit to auto-place below existing cells"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    writes.byApp(async ({ appId, sheetId, visualization, title, dimensions, measures, options, position }) => {
      const app = await engine.app(appId);
      const prepared = await prepareDefinition(app, "create", visualization, title, dimensions ?? [], measures ?? [], options);

      const sheet = await app.getObject(sheetId);
      const { objectId, handle } = await createVizObject(sheet, visualization, prepared);

      const props = await sheet.getProperties();
      const { cell, grid } = placeCell(props, objectId, visualization, position);
      await sheet.setProperties(props);
      await saveApp(app);

      const known = await knownVisualizations(qrs, cfg.host);
      const validation = await validateObject(app, objectId, known, undefined, { handle });
      const placement = await placementFor(sheet, props, grid, objectId);
      return text(redactSecrets({
        objectId, sheetId, cell, validation, placementFindings: placement,
        ...(prepared.notes.length ? { notes: prepared.notes } : {}),
      }));
    }),
  );

  server.registerTool(
    "update_sheet_object",
    {
      description:
        "Rebuild an existing builder-supported object in place (same object id, same visualization type) and " +
        "re-run the render-validation gate. Omitted title/dimensions/measures are carried over from the current " +
        "object (labels, number formats, master links included). Options are NOT merged: pass the full styling " +
        "you want — omitted options revert to the defaults. Same pre-flight refusals as add_sheet_object. " +
        "MUTATION: overwrites the object's properties.",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        objectId: z.string().describe("Object id (from add_sheet_object or get_sheet_objects)"),
        title: z.string().optional(),
        dimensions: dimensionsParam,
        measures: measuresParam,
        options: optionsParam,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    writes.byApp(async ({ appId, objectId, title, dimensions, measures, options }) => {
      if (title === undefined && !dimensions && !measures && !options) {
        throw new ToolError("INVALID_INPUT", "Nothing to update: pass at least one of title, dimensions, measures, options");
      }
      const app = await engine.app(appId);
      const obj = await app.getObject(objectId);
      const current = await obj.getProperties();
      const viz: string = current.visualization ?? current.qInfo?.qType;
      // Rebuilding replaces the whole property tree; for a type the builder
      // does not construct (extensions, maps, containers) that would wipe
      // everything it doesn't know about. Refuse instead.
      if (!VIZ_SPECS[viz]) {
        throw new ToolError("VALIDATION_REFUSED", `refusing to update: "${viz}" is not a builder-supported type (${Object.keys(VIZ_SPECS).join(", ")}) — rebuilding it would discard its properties`);
      }
      const isPane = VIZ_SPECS[viz].cube === "filterpane";
      // Carry over only what was omitted, so an unreadable part the caller
      // is replacing anyway cannot block the update.
      const carry = async <T>(what: string, read: () => T | Promise<T>): Promise<T> => {
        try { return await read(); } catch (e) {
          throw new ToolError("VALIDATION_REFUSED", `refusing to update: cannot read the current ${what} (${errMsg(e)})`);
        }
      };
      const dims: ReadonlyArray<DimInput> = dimensions ?? await carry("dimensions", async () => {
        if (!isPane) return current.qListObjectDef ? specsFromProps(current).dimensions : cubeDimSpecs(current.qHyperCubeDef ?? {});
        const kids = await obj.getChildInfos();
        return Promise.all(kids.map(async (c, i) =>
          dimSpecFromDef((await (await app.getObject(c.qId)).getProperties()).qListObjectDef, `filterpane listbox ${i}`)));
      });
      const meas: ReadonlyArray<MeasureInput> = measures ?? await carry("measures", () =>
        (current.qHyperCubeDef?.qMeasures ?? []).map((m, i) => measureSpecFromDef(m, `measure ${i}`)));
      const currentTitle = typeof current.title === "string" ? current.title : undefined;
      const prepared = await prepareDefinition(app, "update", viz, title ?? currentTitle, dims, meas, options);
      const props = prepared.props;
      props.qInfo = { ...props.qInfo, qId: current.qInfo.qId };
      if (title === undefined) {
        // Keep a title EXPRESSION ({qStringExpression}) and authored
        // text-image markdown verbatim rather than flattening them.
        props.title = current.title ?? "";
        if (viz === "text-image" && current.markdown !== undefined) props.markdown = current.markdown;
      }
      if (current.qMetaDef) props.qMetaDef = current.qMetaDef;
      await obj.setProperties(props);
      if (isPane) {
        // Rebuild the listbox children: destroy-and-recreate is simpler and
        // safer than diffing them, and children carry no user state.
        for (const c of await obj.getChildInfos()) await obj.destroyChild(c.qId);
        for (const lb of buildFilterpaneChildren(prepared.dims)) await obj.createChild(lb);
      }
      await saveApp(app);

      const validation = await validateObject(app, objectId, await knownVisualizations(qrs, cfg.host), undefined, { handle: obj });
      return text(redactSecrets({
        objectId, visualization: viz, validation,
        ...(prepared.notes.length ? { notes: prepared.notes } : {}),
      }));
    }),
  );

  server.registerTool(
    "move_sheet_object",
    {
      description:
        "Move/resize an object's cell on a sheet (grows the grid if needed, like add_sheet_object) and run " +
        "placement lint. Also places an object that has no cell yet. MUTATION.",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        sheetId: z.string().describe("Sheet id"),
        objectId: z.string().describe("Object id (a child of the sheet)"),
        position: positionSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    writes.byApp(async ({ appId, sheetId, objectId, position }) => {
      const app = await engine.app(appId);
      const sheet = await app.getObject(sheetId);
      await requireChildOf(sheet, sheetId, objectId);
      const props = await sheet.getProperties();
      const previous = (props.cells ?? []).find((c) => c.name === objectId);
      const viz: string = previous?.type
        ?? await (async () => { const p = await (await app.getObject(objectId)).getProperties(); return p.visualization ?? p.qInfo?.qType; })();
      const { cell, grid } = placeCell(props, objectId, viz, position);
      await sheet.setProperties(props);
      await saveApp(app);
      return text({
        objectId, sheetId, previous: previous ? cellBox(previous) : null, cell, grid,
        placementFindings: await placementFor(sheet, props, grid, objectId),
      });
    }),
  );

  server.registerTool(
    "delete_sheet_object",
    {
      description:
        "Delete an object from a sheet (and its children, e.g. a filterpane's listboxes) and remove its cell. " +
        "MUTATION: irreversible once saved.",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        sheetId: z.string().describe("Sheet id"),
        objectId: z.string().describe("Object id (a child of the sheet)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    writes.byApp(async ({ appId, sheetId, objectId }) => {
      const app = await engine.app(appId);
      const sheet = await app.getObject(sheetId);
      await requireChildOf(sheet, sheetId, objectId);
      await sheet.destroyChild(objectId);
      // Re-read AFTER destroyChild so the cell edit does not write back a
      // stale property snapshot. A leftover cell would be an orphan the gate
      // then flags on every validate_sheet.
      const props = await sheet.getProperties();
      props.cells = (props.cells ?? []).filter((c) => c.name !== objectId);
      await sheet.setProperties(props);
      await saveApp(app);
      const remaining = (await sheet.getChildInfos()).map((c) => c.qId);
      return text({
        deleted: objectId, sheetId, remainingObjects: remaining.length,
        placementFindings: checkCellPlacement(props.cells.map(cellBox), remaining, props.columns ?? 24, props.rows ?? 12),
      });
    }),
  );
}
