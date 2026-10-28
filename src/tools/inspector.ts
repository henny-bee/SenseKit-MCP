import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EngineClient } from "../clients/engine.js";
import { text } from "../core/result.js";
import { READ } from "../core/annotations.js";
import { guid, pageParams } from "../core/schemas.js";
import { paginate } from "../core/paging.js";
import { walkStrings } from "../core/walk.js";
import { classifyLineage } from "../core/lineage.js";
import { scrubString, redactSecrets } from "../core/redact.js";
import { expressionWarnings, activeSelections } from "../qix/quality.js";
import { sheetList, objectToSheetMap } from "../qix/objects.js";
import { mapPool, ENGINE_CONCURRENCY } from "../core/pool.js";
import { ToolError } from "../core/errors.js";
import type { GenericObjectProperties } from "../qix/types.js";

export function registerInspectorTools(server: McpServer, engine: EngineClient): void {
  server.registerTool(
    "list_sheets",
    {
      description: "List an app's sheets with id, title, and published state. The entry point for walking an app's UI layer.",
      inputSchema: { appId: guid.describe("App id (GUID)") },
      annotations: READ,
    },
    async ({ appId }) => {
      const app = await engine.app(appId);
      return text(await sheetList(app));
    },
  );

  server.registerTool(
    "get_sheet_objects",
    {
      description: "List the visualization objects on a sheet: id, type, visualization, and title. The sheet -> object step of a KPI trace.",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        sheetId: z.string().describe("Sheet id (from list_sheets)"),
      },
      annotations: READ,
    },
    async ({ appId, sheetId }) => {
      const app = await engine.app(appId);
      const sheet = await app.getObject(sheetId);
      const children = await sheet.getChildInfos();
      // mapPool keeps sheet order.
      const out = await mapPool(children, ENGINE_CONCURRENCY, async (c) => {
        let title: string | undefined;
        let visualization: string | undefined;
        try {
          const child = await app.getObject(c.qId);
          const prop = await child.getProperties();
          visualization = prop.visualization;
          title = typeof prop.title === "string" ? prop.title
            : prop.title?.qStringExpression?.qExpr ?? prop.qMetaDef?.title;
        } catch { /* keep id+type only */ }
        return { objectId: c.qId, qType: c.qType, visualization, title };
      });
      return text({ sheetId, objects: out });
    },
  );

  server.registerTool(
    "get_object_properties",
    {
      description: "Full property tree (qProps) of any object — the definition layer: measures, dimensions, expressions, extension config. The object -> definition step of a KPI trace.",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        objectId: z.string().describe("Object id (from get_sheet_objects or search_expressions)"),
      },
      annotations: READ,
    },
    async ({ appId, objectId }) => {
      const app = await engine.app(appId);
      const obj = await app.getObject(objectId);
      // Extension objects can embed connection strings in their config.
      return text(redactSecrets(await obj.getProperties()));
    },
  );

  server.registerTool(
    "search_expressions",
    {
      description: "Find where an expression fragment, field, or KPI term is used across an ENTIRE app: every object's properties (with owning sheet), master measures/dimensions, variables, and the load script. The 'where does this number come from' tool. NOTE: on a PUBLISHED app the engine hides the load script from user identities, so script matches only appear for unpublished apps you own — copy_app the target and search the copy to include script hits.",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        term: z.string().min(2).describe("Search term, e.g. a field name, measure label, or expression fragment"),
        caseSensitive: z.boolean().optional().describe("Default false"),
        maxMatches: z.number().int().positive().max(500).optional().describe("Cap on returned matches (default 100)"),
      },
      annotations: READ,
    },
    async ({ appId, term, caseSensitive, maxMatches }) => {
      const app = await engine.app(appId);
      const needle = caseSensitive ? term : term.toLowerCase();
      const cap = maxMatches ?? 100;
      const matches: Array<Record<string, unknown>> = [];
      let truncated = false;

      const snippet = (s: string) => {
        const hay = caseSensitive ? s : s.toLowerCase();
        const i = hay.indexOf(needle);
        const start = Math.max(0, i - 60);
        // A hit inside a connection string must not carry the secret out.
        return scrubString((start > 0 ? "…" : "") + s.slice(start, i + term.length + 60) + (i + term.length + 60 < s.length ? "…" : ""));
      };
      const hit = (where: Record<string, unknown>, path: string, s: string) => {
        if (matches.length >= cap) { truncated = true; return; }
        const hay = caseSensitive ? s : s.toLowerCase();
        if (hay.includes(needle) && s.length < 50_000) {
          matches.push({ ...where, path, snippet: snippet(s) });
        }
      };

      const sheetOf = await objectToSheetMap(app);
      const infos = await app.getAllInfos();
      let objectsScanned = 0;
      // Fetch in batches but match in getAllInfos order, so results equal a sequential walk.
      scan: for (let start = 0; start < infos.length; start += ENGINE_CONCURRENCY) {
        if (matches.length >= cap) { truncated = true; break; }
        const batch = infos.slice(start, start + ENGINE_CONCURRENCY);
        const props = await mapPool(batch, ENGINE_CONCURRENCY, async (info): Promise<GenericObjectProperties | undefined> => {
          try {
            return await (await app.getObject(info.qId)).getProperties();
          } catch { return undefined; /* not a generic object */ }
        });
        for (const [j, info] of batch.entries()) {
          if (matches.length >= cap) { truncated = true; break scan; }
          const prop = props[j];
          if (prop === undefined) continue;
          objectsScanned++;
          const owner = sheetOf.get(info.qId);
          walkStrings(prop, "", (path, s) =>
            hit({ kind: "object", objectId: info.qId, qType: info.qType, ...(owner ?? {}) }, path, s));
        }
      }

      for (const [listDef, listKey, kind] of [
        [{ qMeasureListDef: { qType: "measure", qData: { def: "/qMeasure" } } }, "qMeasureList", "master_measure"],
        [{ qDimensionListDef: { qType: "dimension", qData: { def: "/qDim" } } }, "qDimensionList", "master_dimension"],
      ] as const) {
        const lo = await app.createSessionObject({ qInfo: { qType: `mcp-search-${kind}` }, ...listDef });
        try {
          const layout = await lo.getLayout();
          for (const it of layout[listKey]?.qItems ?? []) {
            walkStrings(it, "", (path, s) =>
              hit({ kind, itemId: it.qInfo?.qId, title: it.qMeta?.title }, path, s));
          }
        } finally {
          await app.destroySessionObject(lo.id).catch(() => {});
        }
      }

      const vl = await app.createSessionObject({
        qInfo: { qType: "mcp-search-vars" },
        qVariableListDef: { qType: "variable", qData: { definition: "/qDefinition" } },
      });
      try {
        const layout = await vl.getLayout();
        for (const v of layout.qVariableList?.qItems ?? []) {
          walkStrings(v, "", (path, s) => hit({ kind: "variable", name: v.qName }, path, s));
        }
      } finally {
        await app.destroySessionObject(vl.id).catch(() => {});
      }

      const script: string = await app.getScript();
      script.split("\n").forEach((line, i) => {
        if (matches.length >= cap) { truncated = true; return; }
        const hay = caseSensitive ? line : line.toLowerCase();
        if (hay.includes(needle)) {
          matches.push({ kind: "script", line: i + 1, snippet: scrubString(line.trim().slice(0, 240)) });
        }
      });

      return text({ term, objectsScanned, matchCount: matches.length, truncated, matches });
    },
  );

  server.registerTool(
    "list_master_measures",
    {
      description: "List the app's master measures: id, title, label, expression. Paged.",
      inputSchema: { appId: guid.describe("App id (GUID)"), ...pageParams },
      annotations: READ,
    },
    async ({ appId, offset, limit }) => {
      const app = await engine.app(appId);
      const lo = await app.createSessionObject({
        qInfo: { qType: "mcp-measurelist" },
        qMeasureListDef: { qType: "measure", qData: { def: "/qMeasure" } },
      });
      try {
        const layout = await lo.getLayout();
        const items = (layout.qMeasureList?.qItems ?? []).map((m) => ({
          measureId: m.qInfo.qId,
          title: m.qMeta?.title,
          label: m.qData?.def?.qLabel,
          expression: m.qData?.def?.qDef,
          tags: m.qMeta?.tags,
        }));
        return text(paginate(items, offset, limit));
      } finally {
        await app.destroySessionObject(lo.id).catch(() => {});
      }
    },
  );

  server.registerTool(
    "list_master_dimensions",
    {
      description: "List the app's master dimensions: id, title, field definitions. Paged.",
      inputSchema: { appId: guid.describe("App id (GUID)"), ...pageParams },
      annotations: READ,
    },
    async ({ appId, offset, limit }) => {
      const app = await engine.app(appId);
      const lo = await app.createSessionObject({
        qInfo: { qType: "mcp-dimensionlist" },
        qDimensionListDef: { qType: "dimension", qData: { def: "/qDim" } },
      });
      try {
        const layout = await lo.getLayout();
        const items = (layout.qDimensionList?.qItems ?? []).map((d) => ({
          dimensionId: d.qInfo.qId,
          title: d.qMeta?.title,
          label: d.qData?.def?.qLabelExpression ?? d.qData?.def?.qFieldLabels?.[0],
          fieldDefs: d.qData?.def?.qFieldDefs,
          grouping: d.qData?.def?.qGrouping,
        }));
        return text(paginate(items, offset, limit));
      } finally {
        await app.destroySessionObject(lo.id).catch(() => {});
      }
    },
  );

  server.registerTool(
    "evaluate_master_measure",
    {
      description: "Evaluate a master measure by id or title in the current selection state. Fetches the measure's expression and evaluates it — the KPI -> value step of a trace. (Referencing a master measure as [Name] in a raw expression resolves to a FIELD, not the measure — this tool exists so you never hit that trap.)",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        measureId: z.string().optional().describe("Master measure id"),
        title: z.string().optional().describe("Master measure title (used when measureId is omitted)"),
      },
      annotations: READ,
    },
    async ({ appId, measureId, title }) => {
      if (!measureId && !title) throw new ToolError("INVALID_INPUT", "Provide measureId or title");
      const app = await engine.app(appId);
      let id = measureId;
      if (!id) {
        const lo = await app.createSessionObject({
          qInfo: { qType: "mcp-mm-resolve" },
          qMeasureListDef: { qType: "measure", qData: {} },
        });
        try {
          const layout = await lo.getLayout();
          const found = (layout.qMeasureList?.qItems ?? []).find((m) => m.qMeta?.title === title);
          if (!found) throw new ToolError("NOT_FOUND", `Master measure not found by title: ${title}`, { title });
          id = found.qInfo.qId;
        } finally {
          await app.destroySessionObject(lo.id).catch(() => {});
        }
      }
      const measure = await app.getMeasure(id!);
      const prop = await measure.getProperties();
      const expression: string | undefined = prop.qMeasure?.qDef;
      if (!expression) throw new ToolError("NOT_FOUND", `Measure ${id} has no expression definition`, { measureId: id });
      const warnings = await expressionWarnings(app, expression);
      const r = await app.evaluateEx(expression);
      return text({
        measureId: id,
        title: prop.qMetaDef?.title ?? title,
        label: prop.qMeasure?.qLabel,
        expression,
        value: r.qIsNumeric ? r.qNumber : r.qText,
        isNumeric: r.qIsNumeric,
        ...(warnings.length ? { warnings } : {}),
        activeSelections: await activeSelections(app),
      });
    },
  );

  server.registerTool(
    "get_app_lineage",
    {
      description: "Data lineage of an app's load script as the engine sees it: every LOAD/STORE source and target (files, QVDs, databases, resident, inline, binary). The app -> source step of a trace. NOTE: on a PUBLISHED app the engine denies lineage to user identities (certificate/internal identities bypass this) — copy_app the target and read the copy's lineage.",
      inputSchema: { appId: guid.describe("App id (GUID)") },
      annotations: READ,
    },
    async ({ appId }) => {
      const app = await engine.app(appId);
      const lineage: Array<{ qDiscriminator?: string; qStatement?: string }> = await app.getLineage();
      return text(lineage.map((l) => ({
        kind: classifyLineage(l.qDiscriminator, l.qStatement),
        discriminator: l.qDiscriminator,
        statement: l.qStatement,
      })));
    },
  );
}
