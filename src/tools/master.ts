import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EngineClient } from "../clients/engine.js";
import type { Config } from "../config.js";
import { text } from "../core/result.js";
import { errMsg, ToolError } from "../core/errors.js";
import { guid } from "../core/schemas.js";
import { redactSecrets } from "../core/redact.js";
import { expressionWarnings, fieldNames, masterItems, titleTaken } from "../qix/quality.js";
import { libraryReferences } from "../qix/objects.js";
import { saveApp } from "../qix/save.js";
import type { KeyedLock } from "../core/lock.js";
import { numFormatToEngine, type EngineNumFormat } from "../viz/number-format.js";
import { numberFormatSchema } from "../viz/schemas.js";

// Master-item governance: create and retire the app's governed measures and
// dimensions. Charts link to master items by qLibraryId, never by title — so
// deleting one that is still linked leaves every referencing chart drawing an
// error tile, with nothing in the engine to warn you. delete_master_item finds
// the links first and refuses unless forced.
//
// All three tools are mutations and register only with QSEOW_ALLOW_MUTATIONS.

export function registerMasterTools(server: McpServer, engine: EngineClient, cfg: Config, writes: KeyedLock): void {
  if (!cfg.allowMutations) return;

  server.registerTool(
    "create_master_measure",
    {
      description:
        "Create a master (library) measure. The expression is checked with the engine first and refused on any " +
        "error or unknown field; a duplicate title is refused. Link it into charts via add_sheet_object " +
        "measures: [{ libraryId }]. Number formats are NOT yet render-verified. MUTATION (additive).",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        title: z.string().min(1).describe("Master item title (shown in the asset panel)"),
        expression: z.string().min(1).describe("Measure expression, e.g. 'Sum(Sales)'"),
        label: z.string().optional().describe("Label shown in charts (default: title)"),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        numberFormat: numberFormatSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    writes.byApp(async ({ appId, title, expression, label, description, tags, numberFormat }) => {
      // Master measures are stored WITHOUT the leading "=" (as the client
      // writes them); evaluate_master_measure evaluates this string as-is.
      const expr = expression.trim().replace(/^=/, "").trim();
      if (!expr) throw new ToolError("INVALID_INPUT", "refusing to create: empty expression");
      let nf: EngineNumFormat | undefined;
      try {
        nf = numberFormat ? numFormatToEngine(numberFormat) : undefined;
      } catch (e) {
        throw new ToolError("INVALID_INPUT", `refusing to create: ${errMsg(e)}`);
      }
      const app = await engine.app(appId);
      // Stricter than the chart builder on purpose: a master measure is the
      // governed definition every chart inherits, so an unknown field (which
      // silently evaluates to 0) is refused here, not merely flagged.
      const warnings = await expressionWarnings(app, expr);
      if (warnings.length) throw new ToolError("VALIDATION_REFUSED", `refusing to create: ${warnings.join("; ")}`, { expression: expr, warnings });
      const clash = titleTaken((await masterItems(app, ["measure"])).measures, title);
      if (clash) throw new ToolError("CONFLICT", `refusing to create: a master measure titled "${title}" already exists (${clash})`, { existingId: clash });

      const measure = await app.createMeasure({
        qInfo: { qType: "measure" },
        qMeasure: {
          qLabel: label ?? title, qDef: expr, qGrouping: "N", qExpressions: [], qActiveExpression: 0,
          ...(nf ?? {}),
        },
        qMetaDef: { title, description: description ?? "", tags: tags ?? [] },
      });
      const measureId = (await measure.getLayout()).qInfo.qId;
      await saveApp(app);
      return text({ measureId, title, label: label ?? title, expression: expr, ...(nf ? { numFormat: nf.qNumFormat } : {}) });
    }),
  );

  server.registerTool(
    "create_master_dimension",
    {
      description:
        "Create a master (library) dimension: one field (single) or several (drill-down group, top level first). " +
        "Fields must exist in the data model; calculated fields ('=...') are checked with the engine. A duplicate " +
        "title is refused. Link it into charts via add_sheet_object dimensions: [{ libraryId }]. MUTATION (additive).",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        title: z.string().min(1).describe("Master item title"),
        fields: z.array(z.string().min(1)).min(1).max(20).describe("Field names (or '=...' calculated); >1 = drill-down"),
        label: z.string().optional().describe("Label shown in charts (default: title; drill-down: first field)"),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    writes.byApp(async ({ appId, title, fields, label, description, tags }) => {
      const app = await engine.app(appId);
      const plain = fields.filter((f) => !f.startsWith("="));
      if (plain.length) {
        const known = await fieldNames(app);
        const missing = plain.filter((f) => !known.has(f));
        if (missing.length) throw new ToolError("NOT_FOUND", `refusing to create: field(s) not in the data model: ${missing.join(", ")}`, { missingFields: missing });
      }
      for (const f of fields.filter((x) => x.startsWith("="))) {
        const w = await expressionWarnings(app, f.slice(1));
        if (w.length) throw new ToolError("VALIDATION_REFUSED", `refusing to create: ${f}: ${w.join("; ")}`, { field: f, warnings: w });
      }
      const clash = titleTaken((await masterItems(app, ["dimension"])).dimensions, title);
      if (clash) throw new ToolError("CONFLICT", `refusing to create: a master dimension titled "${title}" already exists (${clash})`, { existingId: clash });

      const drill = fields.length > 1;
      // A single dimension shows its label (default: the master title, as
      // the client does). A drill-down shows the CURRENT level's label, so
      // each level keeps its field name; `label` only renames the top level.
      const labels = drill
        ? fields.map((f, i) => (i === 0 && label !== undefined ? label : f.startsWith("=") ? "" : f))
        : [label ?? title];
      const dim = await app.createDimension({
        qInfo: { qType: "dimension" },
        qDim: { qGrouping: drill ? "H" : "N", qFieldDefs: fields, qFieldLabels: labels, title },
        qMetaDef: { title, description: description ?? "", tags: tags ?? [] },
      });
      const dimensionId = (await dim.getLayout()).qInfo.qId;
      await saveApp(app);
      return text({ dimensionId, title, grouping: drill ? "drill-down" : "single", fields, labels });
    }),
  );

  server.registerTool(
    "delete_master_item",
    {
      description:
        "Delete a master measure or dimension. First finds every object that links to it (qLibraryId) and " +
        "REFUSES when any exists — those charts would render an error tile — unless force is true. " +
        "MUTATION: irreversible once saved.",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        kind: z.enum(["measure", "dimension"]),
        id: z.string().min(1).describe("Master item id (list_master_measures / list_master_dimensions)"),
        force: z.boolean().optional().describe("Delete even when objects still link to it (default false)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    writes.byApp(async ({ appId, kind, id, force }) => {
      const app = await engine.app(appId);
      const masters = await masterItems(app, [kind]);
      const items = kind === "measure" ? masters.measures : masters.dimensions;
      if (!items.has(id)) throw new ToolError("NOT_FOUND", `master ${kind} ${id} not found in this app`, { kind, id });
      const title = items.get(id);
      const refs = await libraryReferences(app, id);
      if (refs.length && !force) {
        const list = refs.map((r) => `${r.objectId} (${r.qType}${r.title ? ` "${r.title}"` : ""}${r.sheetTitle ? ` on sheet "${r.sheetTitle}"` : ""})`);
        throw new ToolError(
          "REFERENCED",
          `refusing to delete: master ${kind} "${title}" (${id}) is linked by ${refs.length} object(s): ${list.join(", ")}. ` +
          "Those objects would render an error tile. Re-point them (update_sheet_object) or pass force: true.",
          { kind, id, references: refs },
        );
      }
      const ok = kind === "measure" ? await app.destroyMeasure(id) : await app.destroyDimension(id);
      if (ok === false) throw new ToolError("ENGINE_ERROR", `engine refused to destroy ${kind} ${id}`, { kind, id });
      await saveApp(app);
      return text(redactSecrets({ deleted: id, kind, title, forced: refs.length > 0, brokenReferences: refs }));
    }),
  );
}
