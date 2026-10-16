import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EngineClient } from "../clients/engine.js";
import { text } from "../core/result.js";
import { READ, SESSION_MUT } from "../core/annotations.js";
import { guid, pageParams } from "../core/schemas.js";
import { paginate } from "../core/paging.js";
import { buildSelectValues } from "../qix/selection.js";
import { expressionWarnings, activeSelections } from "../qix/quality.js";
import type { HyperCubeDef } from "../qix/types.js";

export function registerAnalystTools(server: McpServer, engine: EngineClient): void {
  server.registerTool(
    "list_engine_apps",
    {
      description: "List apps visible to the current engine session (id, name, last reload). Paged.",
      inputSchema: { ...pageParams },
      annotations: READ,
    },
    async ({ offset, limit }) => {
      const g = await engine.global();
      const docs = await g.getDocList();
      return text(paginate(docs.map((d) => ({
        id: d.qDocId, name: d.qDocName, lastReload: d.qLastReloadTime, fileSizeBytes: d.qFileSize,
      })), offset, limit));
    },
  );

  server.registerTool(
    "get_app_data_model",
    {
      description: "Tables and fields of an app's data model — the map an analyst needs before querying.",
      inputSchema: { appId: guid.describe("App id (GUID)") },
      annotations: READ,
    },
    async ({ appId }) => {
      const app = await engine.app(appId);
      const layout = await app.getAppLayout();
      const tk = await app.getTablesAndKeys({ qcx: 1000, qcy: 1000 }, { qcx: 0, qcy: 0 }, 30, true, false);
      return text({
        title: layout.qTitle,
        lastReload: layout.qLastReloadTime,
        tables: (tk.qtr ?? []).map((t) => ({
          name: t.qName,
          rows: t.qNoOfRows,
          fields: (t.qFields ?? []).map((f) => ({
            name: f.qName, cardinality: f.qnPresentDistinctValues, tags: f.qTags,
          })),
        })),
      });
    },
  );

  server.registerTool(
    "evaluate_expression",
    {
      description: "Evaluate a Qlik expression against an app in the current selection state, e.g. \"Sum(Sales)\" or \"Count(distinct Customer)\". The response carries a trust envelope: expression validation warnings (a misspelled field returns null/0 WITHOUT erroring) and the active selections the value was computed under.",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        expression: z.string().describe("Qlik expression without leading ="),
      },
      annotations: READ,
    },
    async ({ appId, expression }) => {
      const app = await engine.app(appId);
      const warnings = await expressionWarnings(app, expression);
      const r = await app.evaluateEx(expression);
      const selections = await activeSelections(app);
      return text({
        expression,
        value: r.qText ?? r.qNumber,
        isNumeric: r.qIsNumeric,
        ...(warnings.length ? { warnings } : {}),
        // Always present, even when empty: "computed with no selections" is
        // itself a claim the agent should be able to relay.
        activeSelections: selections,
      });
    },
  );

  server.registerTool(
    "create_hypercube",
    {
      description: "Build a hypercube (group-by query) over an app: dimensions + measure expressions, returns tabular data honoring current selections. The core analyst query tool.",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        dimensions: z.array(z.string()).describe("Field names or dimension expressions"),
        measures: z.array(z.string()).describe("Measure expressions, e.g. 'Sum(Sales)'"),
        maxRows: z.number().int().positive().max(10000).optional().describe("Row limit (default 200)"),
        sortByMeasureDesc: z.number().int().optional().describe("Sort by measure index (0-based), descending"),
      },
      annotations: READ,
    },
    async ({ appId, dimensions, measures, maxRows, sortByMeasureDesc }) => {
      const app = await engine.app(appId);
      const limit = maxRows ?? 200;
      const width = dimensions.length + measures.length;
      const cubeDef: HyperCubeDef = {
          qDimensions: dimensions.map((d) => ({
            qDef: { qFieldDefs: [d] },
            qNullSuppression: false,
          })),
          qMeasures: measures.map((m) => ({ qDef: { qDef: m.startsWith("=") ? m : `=${m}` } })),
          qInitialDataFetch: [{ qLeft: 0, qTop: 0, qWidth: width, qHeight: Math.min(limit, Math.floor(10000 / Math.max(width, 1))) }],
          ...(sortByMeasureDesc !== undefined
            ? { qInterColumnSortOrder: [dimensions.length + sortByMeasureDesc, ...Array.from({ length: width - 1 }, (_, i) => i).filter((i) => i !== dimensions.length + sortByMeasureDesc)] }
            : {}),
      };
      const def = { qInfo: { qType: "mcp-hypercube" }, qHyperCubeDef: cubeDef };
      if (sortByMeasureDesc !== undefined) {
        cubeDef.qMeasures[sortByMeasureDesc].qSortBy = { qSortByNumeric: -1 };
      }
      const warnings: string[] = [];
      for (const m of measures) {
        for (const w of await expressionWarnings(app, m.startsWith("=") ? m.slice(1) : m)) warnings.push(`measure "${m}": ${w}`);
      }
      const obj = await app.createSessionObject(def);
      try {
        const layout = await obj.getLayout();
        // A hypercube session object always lays out a qHyperCube.
        const cube = layout.qHyperCube!;
        (cube.qDimensionInfo ?? []).forEach((d, i) => {
          if (d.qError) warnings.push(`dimension "${dimensions[i]}": engine error qErrorCode=${d.qError.qErrorCode} — check the field name`);
        });
        const page = cube.qDataPages?.[0];
        const rows = (page?.qMatrix ?? []).map((r) =>
          r.map((c) => (c.qNum !== undefined && c.qNum !== "NaN" && !Number.isNaN(c.qNum) ? c.qNum : c.qText)),
        );
        return text({
          columns: [...dimensions, ...measures],
          totalRows: cube.qSize?.qcy,
          returnedRows: rows.length,
          rows,
          ...(warnings.length ? { warnings } : {}),
          activeSelections: await activeSelections(app),
        });
      } finally {
        await app.destroySessionObject(obj.id).catch(() => {});
      }
    },
  );

  server.registerTool(
    "get_field_values",
    {
      description: "List distinct values of a field with selection state (S=selected, O=optional, X=excluded). Optional search term.",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        field: z.string().describe("Field name"),
        maxValues: z.number().int().positive().max(1000).optional().describe("Limit (default 100)"),
        searchTerm: z.string().optional().describe("Search within values"),
      },
      annotations: READ,
    },
    async ({ appId, field, maxValues, searchTerm }) => {
      const app = await engine.app(appId);
      const limit = maxValues ?? 100;
      const obj = await app.createSessionObject({
        qInfo: { qType: "mcp-listobject" },
        qListObjectDef: {
          qDef: { qFieldDefs: [field] },
          qInitialDataFetch: [{ qLeft: 0, qTop: 0, qWidth: 1, qHeight: limit }],
        },
      });
      try {
        if (searchTerm) {
          await obj.searchListObjectFor("/qListObjectDef", searchTerm);
        }
        const layout = await obj.getLayout();
        // A list-object session object always lays out a qListObject.
        const lo = layout.qListObject!;
        const page = lo.qDataPages?.[0];
        return text({
          field,
          cardinality: lo.qDimensionInfo?.qCardinal,
          values: (page?.qMatrix ?? []).map((r) => ({ value: r[0].qText, state: r[0].qState })),
        });
      } finally {
        await app.destroySessionObject(obj.id).catch(() => {});
      }
    },
  );

  server.registerTool(
    "select_field_values",
    {
      description: "Select values in a field (session-scoped; affects subsequent hypercubes/expressions in this MCP session). Numeric values are matched numerically — pass numbers as numbers (or numeric strings; both work). Returns the resulting selected count so a silently-widened or missed selection is visible.",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        field: z.string().describe("Field name"),
        values: z.array(z.union([z.string(), z.number()])).describe("Values to select"),
        toggle: z.boolean().optional().describe("Toggle instead of replace (default false)"),
      },
      annotations: SESSION_MUT,
    },
    async ({ appId, field, values, toggle }) => {
      const app = await engine.app(appId);
      const f = await app.getField(field);
      // Engine trap (measured on Qlik Cloud AND QSEoW): SelectValues with a
      // text-only qText for a numeric field does not error — it silently
      // selects nothing or widens the selection. Numeric field values must be
      // sent as duals: { qText, qIsNumeric: true, qNumber }. Numeric-looking
      // strings get the same treatment; for genuine text fields the engine
      // matches on qText regardless, so the dual form is safe both ways.
      const fieldValues = buildSelectValues(values);
      const readSelection = async () => {
        const sel = await app.createSessionObject({
          qInfo: { qType: "mcp-select-verify" },
          qSelectionObjectDef: {},
        });
        try {
          const layout = await sel.getLayout();
          const row = (layout.qSelectionObject?.qSelections ?? []).find((s) => s.qField === field);
          return { count: row?.qSelectedCount ?? 0, sample: row?.qSelected };
        } finally {
          await app.destroySessionObject(sel.id).catch(() => {});
        }
      };

      let ok = await f.selectValues(fieldValues, toggle ?? false, false);
      let mode = fieldValues.some((v) => v.qIsNumeric) ? "numeric-dual" : "text";
      let verify: { count: number; sample?: string } | undefined;
      try {
        verify = await readSelection();
        // Edge case: a TEXT field whose values merely look numeric ("2026"
        // loaded as text) has no numeric representation, so the dual match
        // can land empty. Retry once text-only and re-verify.
        const sentNumeric = fieldValues.some((v) => v.qIsNumeric);
        if (verify.count === 0 && sentNumeric && !(toggle ?? false)) {
          ok = await f.selectValues(values.map((v) => ({ qText: String(v) })), false, false);
          mode = "text-fallback";
          verify = await readSelection();
        }
      } catch { /* verification is best-effort */ }
      return text({
        field, requested: values, applied: ok, mode,
        selectedCount: verify?.count, selectedSample: verify?.sample,
      });
    },
  );

  server.registerTool(
    "crosscheck_expression",
    {
      description:
        "Adversarial self-check for a numeric answer: evaluates the expression as a single total AND as a " +
        "group-by decomposition over a dimension, then compares total vs sum-of-groups. Agreement is strong " +
        "evidence the number is internally consistent; disagreement flags a non-additive measure (Count DISTINCT, " +
        "ratios, set-analysis pinned to chart scope) or a scoping bug — exactly the cases where a single evaluated " +
        "number can mislead. Use before presenting high-stakes figures.",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        expression: z.string().describe("Measure expression, e.g. 'Sum(Sales)'"),
        groupBy: z.string().describe("Dimension field to decompose over"),
      },
      annotations: READ,
    },
    async ({ appId, expression, groupBy }) => {
      const app = await engine.app(appId);
      const warnings = await expressionWarnings(app, expression);
      const total = await app.evaluateEx(expression);
      const obj = await app.createSessionObject({
        qInfo: { qType: "mcp-crosscheck" },
        qHyperCubeDef: {
          qDimensions: [{ qDef: { qFieldDefs: [groupBy] }, qNullSuppression: false }],
          qMeasures: [{ qDef: { qDef: expression.startsWith("=") ? expression : `=${expression}` } }],
          qInitialDataFetch: [{ qLeft: 0, qTop: 0, qWidth: 2, qHeight: 1000 }],
        },
      });
      try {
        const layout = await obj.getLayout();
        const cube = layout.qHyperCube!;
        const groups = cube.qDataPages?.[0]?.qMatrix ?? [];
        const totalGroups = cube.qSize?.qcy ?? groups.length;
        if (totalGroups > groups.length) {
          warnings.push(`decomposition truncated: ${groups.length} of ${totalGroups} groups fetched — sum-of-groups is partial, comparison unreliable`);
        }
        const sumOfGroups = groups.reduce((acc: number, r) => {
          const v = r[1]?.qNum;
          return acc + (typeof v === "number" && !Number.isNaN(v) ? v : 0);
        }, 0);
        const totalNum = total.qIsNumeric ? total.qNumber : NaN;
        const delta = totalNum - sumOfGroups;
        const consistent = Number.isFinite(totalNum) &&
          totalGroups <= groups.length &&
          Math.abs(delta) <= Math.max(0.005, Math.abs(totalNum) * 1e-9);
        return text({
          expression,
          groupBy,
          total: totalNum,
          sumOfGroups,
          groupCount: totalGroups,
          delta,
          consistent,
          interpretation: consistent
            ? "total equals sum of groups — internally consistent and additive over this dimension"
            : "total does NOT equal sum of groups — the measure is non-additive over this dimension (Count DISTINCT, ratio, or scoped set analysis) or the decomposition is partial; do not present sum-of-groups as the total",
          ...(warnings.length ? { warnings } : {}),
          activeSelections: await activeSelections(app),
        });
      } finally {
        await app.destroySessionObject(obj.id).catch(() => {});
      }
    },
  );

  server.registerTool(
    "get_current_selections",
    {
      description: "Current selection state across all fields in the session.",
      inputSchema: { appId: guid.describe("App id (GUID)") },
      annotations: READ,
    },
    async ({ appId }) => {
      const app = await engine.app(appId);
      const obj = await app.createSessionObject({
        qInfo: { qType: "mcp-selections" },
        qSelectionObjectDef: {},
      });
      try {
        const layout = await obj.getLayout();
        return text((layout.qSelectionObject?.qSelections ?? []).map((s) => ({
          field: s.qField, selectedCount: s.qSelectedCount, selected: s.qSelected,
        })));
      } finally {
        await app.destroySessionObject(obj.id).catch(() => {});
      }
    },
  );

  server.registerTool(
    "clear_selections",
    {
      description: "Clear selections in one field or all fields.",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        field: z.string().optional().describe("Field to clear; omit to clear all"),
      },
      annotations: SESSION_MUT,
    },
    async ({ appId, field }) => {
      const app = await engine.app(appId);
      if (field) {
        const f = await app.getField(field);
        await f.clear();
        return text(`Cleared selections in ${field}`);
      }
      await app.clearAll();
      return text("Cleared all selections");
    },
  );
}
