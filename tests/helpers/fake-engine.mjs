// Tiny in-memory engine, not a recorder: tests assert outcomes, not call order.

export const APP_ID = "11111111-2222-3333-4444-555555555555";
export const NEW_APP_ID = "99999999-8888-7777-6666-555555555555";

// FiscalYear is numeric-looking TEXT: exercises select_field_values' fallback.
export const FIELDS = ["Region", "Product", "Sales", "OrderDate", "FiscalYear"];
export const ROWS = [
  { Region: "East", Product: "Widget", Sales: 10, OrderDate: "2026-01-05", FiscalYear: "2025" },
  { Region: "East", Product: "Gadget", Sales: 20, OrderDate: "2026-02-11", FiscalYear: "2026" },
  { Region: "West", Product: "Widget", Sales: 30, OrderDate: "2026-03-17", FiscalYear: "2026" },
  { Region: "West", Product: "Gizmo", Sales: 40, OrderDate: "2026-04-23", FiscalYear: "2026" },
];

// Holds a credential that get_script / search_expressions must redact.
export const DEFAULT_SCRIPT =
  "SET vPassword = 'hunter2';\r\n" +
  "LIB CONNECT TO 'WarehouseDB';\r\n" +
  "Sales:\r\nLOAD Region, Product, Sales, OrderDate, FiscalYear FROM [lib://Data/sales.qvd] (qvd);\r\n";

// Shaped like an enigma.js rejection; code 2 = LOCERR_GENERIC_NOT_FOUND.
export function qixError(message, code = 2) {
  return Object.assign(new Error(message), { code, parameter: message });
}

const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// As on a real engine, an unknown field evaluates to 0.
const AGG = /^\s*(sum|count|avg|min|max)\(\s*(distinct\s+)?\[?([A-Za-z_]\w*)\]?\s*\)\s*$/i;

export function evaluate(expression, rows) {
  const m = AGG.exec(String(expression).replace(/^=/, ""));
  if (!m) return null;
  const [, fn, distinct, field] = m;
  const vals = rows.map((r) => r[field]).filter((v) => v !== undefined);
  switch (fn.toLowerCase()) {
    case "sum": return vals.reduce((a, v) => a + (Number(v) || 0), 0);
    case "count": return distinct ? new Set(vals).size : vals.length;
    case "avg": return vals.length ? vals.reduce((a, v) => a + Number(v), 0) / vals.length : 0;
    case "min": return vals.length ? Math.min(...vals.map(Number)) : 0;
    case "max": return vals.length ? Math.max(...vals.map(Number)) : 0;
  }
  return null;
}

// qBadFieldNames are {qFrom, qCount} ranges, like the engine.
export function checkExpression(expression, fields = FIELDS) {
  const open = (expression.match(/\(/g) ?? []).length;
  const close = (expression.match(/\)/g) ?? []).length;
  if (open !== close) return { qErrorMsg: "Error in expression: unbalanced parentheses", qBadFieldNames: [] };
  const bad = [];
  const re = /\b[A-Za-z_]\w*\(\s*(?:distinct\s+)?\[?([A-Za-z_]\w*)\]?\s*\)/gi;
  for (let m; (m = re.exec(expression));) {
    if (!fields.includes(m[1])) bad.push({ qFrom: m.index + m[0].indexOf(m[1]), qCount: m[1].length });
  }
  return { qErrorMsg: "", qBadFieldNames: bad };
}

export function createFakeEngine(opts = {}) {
  const docs = new Map();
  const doc = createDoc(APP_ID, opts);
  Object.assign(doc.api, opts.docOverrides ?? {});
  docs.set(APP_ID, doc);

  const global = {
    getDocList: async () => [...docs.values()].map((d) => ({
      qDocId: d.id, qDocName: d.title, qLastReloadTime: "2026-10-01T02:00:00.000Z", qFileSize: 1024,
    })),
    createApp: async (name) => {
      const d = createDoc(NEW_APP_ID, { ...opts, script: "" });
      d.title = name;
      docs.set(NEW_APP_ID, d);
      return { qSuccess: true, qAppId: NEW_APP_ID };
    },
    getProgress: async () => ({
      qPersistentProgressMessages: [
        { qMessageCode: 1, qMessageParameters: ["Connecting to", "WarehouseDB pwd=hunter2"] },
        { qMessageCode: 2, qMessageParameters: ["Sales << sales.qvd", "4 Lines fetched"] },
      ],
    }),
    ...(opts.globalOverrides ?? {}),
  };

  const engine = {
    async app(appId) {
      if (!GUID_RE.test(appId)) throw new Error(`appId must be a GUID, got: ${appId}`);
      const d = docs.get(appId);
      if (!d) throw qixError(`openDoc(${appId}) failed: App not found`);
      return d.api;
    },
    async global() { return global; },
    async close() {},
  };

  return { engine, doc, docs, global };
}

// Returns test-inspectable state; `.api` is what tools see.
function createDoc(id, opts) {
  let seq = 0;
  const nextId = (prefix) => `${prefix}-${++seq}`;
  const st = {
    id,
    title: "Fake Sales",
    script: opts.script ?? DEFAULT_SCRIPT,
    objects: new Map(),
    measures: new Map(),
    dimensions: new Map(),
    selections: new Map(),
    variables: opts.variables ?? [
      { qName: "vPassword", qDefinition: "pwd=hunter2", qInfo: { qId: "var-1" } },
      { qName: "vSalesTarget", qDefinition: "=Sum(Sales) * 1.1", qInfo: { qId: "var-2" } },
    ],
    lineage: opts.lineage ?? [
      { qDiscriminator: "lib://Data/sales.qvd", qStatement: "LOAD" },
      { qDiscriminator: "INLINE;", qStatement: "LOAD * INLINE" },
      { qDiscriminator: "lib://Data/out.qvd", qStatement: "STORE Sales INTO" },
    ],
    scriptErrors: opts.scriptErrors ?? [],
    reloadResult: opts.reloadResult ?? true,
    saves: 0,
    reloads: [],
  };

  const visibleRows = () => ROWS.filter((r) =>
    [...st.selections].every(([f, set]) => set.has(String(r[f]))));
  const fieldOf = (dimDef) => {
    if (dimDef?.qLibraryId) return st.dimensions.get(dimDef.qLibraryId)?.qDim?.qFieldDefs?.[0];
    return dimDef?.qDef?.qFieldDefs?.[0];
  };
  const exprOf = (measDef) => {
    if (measDef?.qLibraryId) return st.measures.get(measDef.qLibraryId)?.qMeasure?.qDef;
    return measDef?.qDef?.qDef;
  };
  const known = (f) => typeof f === "string" && (f.startsWith("=") || FIELDS.includes(f));
  const cell = (v) => (typeof v === "number" ? { qText: String(v), qNum: v } : { qText: String(v ?? "-"), qNum: "NaN" });

  function computeCube(hc) {
    const dims = (hc.qDimensions ?? []).map(fieldOf);
    const meas = (hc.qMeasures ?? []).map(exprOf);
    const rows = visibleRows();
    const groups = new Map();
    for (const r of rows) {
      const key = dims.map((f) => (f?.startsWith?.("=") ? f : String(r[f] ?? "-")));
      const k = JSON.stringify(key);
      if (!groups.has(k)) groups.set(k, { key, rows: [] });
      groups.get(k).rows.push(r);
    }
    if (!dims.length) groups.set("[]", { key: [], rows });
    let matrix = [...groups.values()].map((g) => [
      ...g.key.map((k) => cell(k)),
      ...meas.map((e) => cell(evaluate(e ?? "", g.rows))),
    ]);
    matrix.sort((a, b) => (a[0]?.qText ?? "").localeCompare(b[0]?.qText ?? ""));
    const first = hc.qInterColumnSortOrder?.[0];
    if (first !== undefined && first >= dims.length) {
      const dir = hc.qMeasures[first - dims.length]?.qSortBy?.qSortByNumeric === 1 ? 1 : -1;
      matrix.sort((a, b) => dir * ((a[first].qNum === "NaN" ? 0 : a[first].qNum) - (b[first].qNum === "NaN" ? 0 : b[first].qNum)));
    }
    const fetch = hc.qInitialDataFetch?.[0];
    const height = fetch?.qHeight ?? matrix.length;
    return {
      qMode: hc.qMode ?? "S",
      qSize: { qcx: dims.length + meas.length, qcy: matrix.length },
      qDimensionInfo: dims.map((f) => (known(f)
        ? { qFallbackTitle: f, qCardinal: new Set(ROWS.map((r) => r[f])).size }
        : { qFallbackTitle: String(f), qError: { qErrorCode: 7 } })),
      qMeasureInfo: meas.map((e) => ({ qFallbackTitle: String(e) })),
      qDataPages: [{ qMatrix: matrix.slice(0, height) }],
    };
  }

  function computeList(lo, search) {
    const f = fieldOf(lo);
    if (!known(f)) return { qDimensionInfo: { qError: { qErrorCode: 7 } }, qSize: { qcy: 0 }, qDataPages: [{ qMatrix: [] }] };
    const visible = new Set(visibleRows().map((r) => String(r[f])));
    const sel = st.selections.get(f);
    let values = [...new Set(ROWS.map((r) => String(r[f])))].sort();
    if (search) values = values.filter((v) => v.toLowerCase().includes(search.toLowerCase()));
    const height = lo.qInitialDataFetch?.[0]?.qHeight ?? values.length;
    return {
      qDimensionInfo: { qFallbackTitle: f, qCardinal: values.length },
      qSize: { qcy: values.length },
      qDataPages: [{
        qMatrix: values.slice(0, height).map((v) => [{
          qText: v, qNum: "NaN", qState: sel?.has(v) ? "S" : visible.has(v) ? "O" : "X",
        }]),
      }],
    };
  }

  function objectHandle(oid) {
    const rec = () => {
      const r = st.objects.get(oid);
      if (!r) throw qixError(`Object ${oid} not found`);
      return r;
    };
    const h = {
      id: oid,
      async getProperties() { return clone(rec().props); },
      async setProperties(p) { rec().props = { ...clone(p), qInfo: { ...p.qInfo, qId: oid } }; },
      async getLayout() {
        const p = rec().props;
        const out = { qInfo: { qId: oid, qType: p.qInfo?.qType }, qMeta: p.qMetaDef ?? {} };
        if (p.qHyperCubeDef) out.qHyperCube = computeCube(p.qHyperCubeDef);
        if (p.qListObjectDef) out.qListObject = computeList(p.qListObjectDef);
        if (p.title !== undefined) out.title = p.title;
        return out;
      },
      async getChildInfos() {
        return rec().children.map((c) => ({ qId: c, qType: st.objects.get(c)?.props.qInfo?.qType }));
      },
      async createChild(p) {
        const cid = nextId("obj");
        st.objects.set(cid, { props: { ...clone(p), qInfo: { ...p.qInfo, qId: cid } }, children: [], parent: oid });
        rec().children.push(cid);
        return objectHandle(cid);
      },
      async destroyChild(cid) {
        const r = rec();
        if (!r.children.includes(cid)) return false;
        const kill = (x) => { st.objects.get(x)?.children.forEach(kill); st.objects.delete(x); };
        kill(cid);
        r.children = r.children.filter((c) => c !== cid);
        return true;
      },
      async getParent() {
        const p = rec().parent;
        if (!p) throw qixError("Object has no parent");
        return objectHandle(p);
      },
      async getFullPropertyTree() {
        const tree = (x) => ({
          qProperty: clone(st.objects.get(x).props),
          qChildren: st.objects.get(x).children.map(tree),
          qEmbeddedSnapshotRef: null,
        });
        rec();
        return tree(oid);
      },
      async setFullPropertyTree(t) {
        await h.setProperties(t.qProperty);
        for (const c of [...rec().children]) await h.destroyChild(c);
        for (const c of t.qChildren ?? []) {
          const ch = await h.createChild(c.qProperty);
          if (c.qChildren?.length) await ch.setFullPropertyTree(c);
        }
      },
    };
    return Object.assign(h, opts.objectOverrides ?? {});
  }

  const itemHandle = (map, mid, kind) => {
    if (!map.has(mid)) throw qixError(`${kind} ${mid} not found`);
    return {
      id: mid,
      async getProperties() { return clone(map.get(mid)); },
      async setProperties(p) { map.set(mid, clone(p)); },
      async getLayout() { return { qInfo: { qId: mid, qType: kind }, qMeta: clone(map.get(mid).qMetaDef) }; },
    };
  };

  function sessionLayout(def) {
    if (def.qFieldListDef) return { qFieldList: { qItems: FIELDS.map((f) => ({ qName: f })) } };
    if (def.qMeasureListDef) {
      return { qMeasureList: { qItems: [...st.measures].map(([mid, m]) => ({
        qInfo: { qId: mid, qType: "measure" }, qMeta: clone(m.qMetaDef), qData: { def: clone(m.qMeasure) },
      })) } };
    }
    if (def.qDimensionListDef) {
      return { qDimensionList: { qItems: [...st.dimensions].map(([did, d]) => ({
        qInfo: { qId: did, qType: "dimension" }, qMeta: clone(d.qMetaDef), qData: { def: clone(d.qDim) },
      })) } };
    }
    if (def.qAppObjectListDef) {
      const type = def.qAppObjectListDef.qType;
      return { qAppObjectList: { qItems: [...st.objects]
        .filter(([, o]) => o.props.qInfo?.qType === type)
        .map(([oid, o]) => ({ qInfo: { qId: oid, qType: type }, qMeta: { title: o.props.qMetaDef?.title, published: false }, qData: {} })) } };
    }
    if (def.qVariableListDef) return { qVariableList: { qItems: clone(st.variables) } };
    if (def.qSelectionObjectDef) {
      return { qSelectionObject: { qSelections: [...st.selections].map(([f, set]) => ({
        qField: f, qSelectedCount: set.size, qSelected: [...set].join(", "),
      })) } };
    }
    if (def.qHyperCubeDef) return { qHyperCube: computeCube(def.qHyperCubeDef) };
    if (def.qListObjectDef) return { qListObject: computeList(def.qListObjectDef, def.__search) };
    return {};
  }

  const api = {
    id,
    async getAppLayout() { return { qTitle: st.title, qLastReloadTime: "2026-10-01T02:00:00.000Z" }; },
    async getAppProperties() { return { qTitle: st.title }; },
    async getTablesAndKeys() {
      return { qtr: [{ qName: "Sales", qNoOfRows: ROWS.length, qFields: FIELDS.map((f) => ({
        qName: f, qnPresentDistinctValues: new Set(ROWS.map((r) => r[f])).size, qTags: f === "Sales" ? ["$numeric"] : ["$text"],
      })) }], qk: [] };
    },
    async getObject(oid) {
      if (!st.objects.has(oid)) throw qixError(`Object ${oid} not found`);
      return objectHandle(oid);
    },
    async createObject(p) {
      const oid = nextId(p.qInfo?.qType ?? "obj");
      st.objects.set(oid, { props: { ...clone(p), qInfo: { ...p.qInfo, qId: oid } }, children: [], parent: undefined });
      return objectHandle(oid);
    },
    async destroyObject(oid) { return st.objects.delete(oid); },
    async getAllInfos() {
      return [
        ...[...st.objects].map(([oid, o]) => ({ qId: oid, qType: o.props.qInfo?.qType })),
        ...[...st.measures.keys()].map((mid) => ({ qId: mid, qType: "measure" })),
        ...[...st.dimensions.keys()].map((did) => ({ qId: did, qType: "dimension" })),
      ];
    },
    async createSessionObject(def) {
      const d = clone(def);
      return {
        id: nextId("session"),
        async getLayout() { return sessionLayout(d); },
        async searchListObjectFor(_path, term) { d.__search = term; return true; },
        async getHyperCubeData() { return sessionLayout(d).qHyperCube.qDataPages; },
        async getListObjectData() { return sessionLayout(d).qListObject.qDataPages; },
      };
    },
    async destroySessionObject() { return true; },
    async checkExpression(e) { return checkExpression(e); },
    async evaluateEx(e) {
      const v = evaluate(e, visibleRows());
      return v === null ? { qText: "-", qNumber: "NaN", qIsNumeric: false } : { qText: String(v), qNumber: v, qIsNumeric: true };
    },
    async evaluate(e) { return String(evaluate(e, visibleRows()) ?? "-"); },
    async getField(f) {
      return {
        async selectValues(values, toggle = false) {
          // Engine trap: a numeric dual only matches numeric values, text matches qText.
          const hit = new Set();
          for (const r of ROWS) {
            const v = r[f];
            if (v === undefined) continue;
            if (values.some((x) => (x.qIsNumeric ? typeof v === "number" && v === x.qNumber : String(v) === x.qText))) hit.add(String(v));
          }
          const cur = st.selections.get(f) ?? new Set();
          const next = toggle ? new Set([...cur].filter((v) => !hit.has(v)).concat([...hit].filter((v) => !cur.has(v)))) : hit;
          if (next.size) st.selections.set(f, next); else st.selections.delete(f);
          return true;
        },
        async clear() { st.selections.delete(f); return true; },
      };
    },
    async clearAll() { st.selections.clear(); },
    async getScript() { return st.script; },
    async setScript(s) { st.script = s; },
    async checkScriptSyntax() { return clone(st.scriptErrors); },
    async doReload(_mode, partial) { st.reloads.push({ partial: Boolean(partial) }); return st.reloadResult; },
    async doSave() { st.saves++; },
    async getLineage() { return clone(st.lineage); },
    async createMeasure(p) {
      const mid = nextId("measure");
      st.measures.set(mid, { ...clone(p), qInfo: { ...p.qInfo, qId: mid } });
      return itemHandle(st.measures, mid, "measure");
    },
    async createDimension(p) {
      const did = nextId("dimension");
      st.dimensions.set(did, { ...clone(p), qInfo: { ...p.qInfo, qId: did } });
      return itemHandle(st.dimensions, did, "dimension");
    },
    async getMeasure(mid) { return itemHandle(st.measures, mid, "measure"); },
    async getDimension(did) { return itemHandle(st.dimensions, did, "dimension"); },
    async destroyMeasure(mid) { return st.measures.delete(mid); },
    async destroyDimension(did) { return st.dimensions.delete(did); },
  };
  st.api = api;
  return st;
}
