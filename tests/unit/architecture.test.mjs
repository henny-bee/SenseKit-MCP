import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function walk(dir, exts) {
  const out = [];
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const rel = posix.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "build") out.push(...walk(rel, exts)); }
    else if (exts.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}

// Line-anchored so commented-out code and strings like "wss://" never match.
const STATIC = /^[ \t]*(import|export)\b([^;]*?)\bfrom\s+["']([^"']+)["']/gm;
const SIDE_EFFECT = /^[ \t]*import\s+["']([^"']+)["']/gm;
const DYNAMIC = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function importsOf(rel) {
  const src = readFileSync(join(ROOT, rel), "utf8");
  const out = [];
  for (const m of src.matchAll(STATIC)) {
    const clause = m[2].trim();
    out.push({ spec: m[3], typeOnly: /^type\b/.test(clause) });
  }
  for (const m of src.matchAll(SIDE_EFFECT)) out.push({ spec: m[1], typeOnly: false });
  for (const line of src.split(/\r?\n/)) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    for (const m of line.matchAll(DYNAMIC)) out.push({ spec: m[1], typeOnly: false });
  }
  return out.filter((i) => i.spec.startsWith("."));
}

function resolveTs(from, spec) {
  const base = posix.normalize(posix.join(posix.dirname(from), spec));
  const candidates = base.endsWith(".js")
    ? [base.slice(0, -3) + ".ts"]
    : [base, `${base}.ts`, `${base}/index.ts`];
  return candidates.find((c) => existsSync(join(ROOT, c)) && statSync(join(ROOT, c)).isFile());
}

const FILES = walk("src", [".ts"]).filter((f) => !f.endsWith(".d.ts"));
const GRAPH = new Map();
const UNRESOLVED = [];
for (const f of FILES) {
  const edges = [];
  for (const i of importsOf(f)) {
    const target = resolveTs(f, i.spec);
    if (!target) UNRESOLVED.push(`${f} → "${i.spec}"`);
    else edges.push({ ...i, target });
  }
  GRAPH.set(f, edges);
}

const layer = (f) => f.split("/")[1];
const edges = () => [...GRAPH].flatMap(([from, es]) => es.map((e) => ({ from, ...e })));
const fmt = (e) => `${e.from} → "${e.spec}" (${e.target})`;

function assertNoEdges(description, bad) {
  const offenders = edges().filter(bad).map(fmt);
  assert.deepEqual(offenders, [], `${description}:\n  ${offenders.join("\n  ")}`);
}

test("architecture: the parser sees the real graph (guards against a vacuous pass)", () => {
  assert.ok(FILES.length >= 40, `only ${FILES.length} src files found`);
  assert.ok(edges().length >= 100, `only ${edges().length} import edges found`);
  assert.ok(edges().some((e) => e.from === "src/server.ts" && e.target === "src/tools/index.ts"), "server.ts -> tools/index.ts edge missing");
  assert.ok(edges().some((e) => e.from === "src/clients/engine.ts" && e.target === "src/qix/types.ts" && e.typeOnly), "type-only import not detected");
});

test("architecture: every relative import in src/ resolves to a file", () => {
  assert.deepEqual(UNRESOLVED, [], `unresolved imports:\n  ${UNRESOLVED.join("\n  ")}`);
});

test("architecture: no import cycles in src/", () => {
  const state = new Map(); // 1 = on stack, 2 = done
  const cycles = [];
  const dfs = (n, stack) => {
    state.set(n, 1);
    stack.push(n);
    for (const { target } of GRAPH.get(n) ?? []) {
      if (state.get(target) === 1) cycles.push([...stack.slice(stack.indexOf(target)), target].join(" → "));
      else if (!state.get(target)) dfs(target, stack);
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const n of GRAPH.keys()) if (!state.get(n)) dfs(n, []);
  assert.deepEqual(cycles, [], `import cycles:\n  ${cycles.join("\n  ")}`);
});

test("architecture: core/ imports nothing outside core/", () => {
  assertNoEdges("core/ must stay dependency-free", (e) => layer(e.from) === "core" && layer(e.target) !== "core");
});

test("architecture: clients/ imports only config.ts, core/, clients/ and (type-only) qix/types.ts", () => {
  const allowed = (e) =>
    e.target === "src/config.ts" ||
    ["core", "clients"].includes(layer(e.target)) ||
    (e.target === "src/qix/types.ts" && e.typeOnly);
  assertNoEdges("clients/ layer violation", (e) => layer(e.from) === "clients" && !allowed(e));
});

test("architecture: qix/ never imports viz/, tools/, clients/ or the entry points; qix/types.ts imports nothing", () => {
  const banned = new Set(["viz", "tools", "clients", "server.ts", "index.ts"]);
  assertNoEdges("qix/ layer violation", (e) => layer(e.from) === "qix" && banned.has(layer(e.target)));
  assertNoEdges("qix/types.ts must be a leaf", (e) => e.from === "src/qix/types.ts");
});

test("architecture: viz/ never imports tools/ or the entry points", () => {
  const banned = new Set(["tools", "server.ts", "index.ts"]);
  assertNoEdges("viz/ layer violation", (e) => layer(e.from) === "viz" && banned.has(layer(e.target)));
});

test("architecture: tools/ never imports the entry points", () => {
  assertNoEdges("tools/ layer violation", (e) => layer(e.from) === "tools" && ["server.ts", "index.ts"].includes(layer(e.target)));
});

test("architecture: only server.ts / index.ts import tools/index.ts", () => {
  assertNoEdges("tools/index.ts is the composition root's import", (e) =>
    e.target === "src/tools/index.ts" && !["src/server.ts", "src/index.ts"].includes(e.from));
});

test("architecture: relative imports in scripts/, examples/, tests/ and mcpb/ resolve (dist/ after a build)", () => {
  const missing = [];
  for (const f of ["scripts", "examples", "tests", "mcpb"].flatMap((d) => walk(d, [".mjs", ".js"]))) {
    for (const { spec } of importsOf(f)) {
      const target = posix.normalize(posix.join(posix.dirname(f), spec));
      if (!existsSync(join(ROOT, target))) missing.push(`${f} → "${spec}"`);
    }
  }
  assert.deepEqual(missing, [], `unresolved imports:\n  ${missing.join("\n  ")}`);
});
