#!/usr/bin/env node
// Usage: node scripts/gen-tools-doc.mjs [--check]   (after npm run build)
// Offline: boots dist/ with dummy config per group/mode; only calls tools/list.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, "dist", "index.js");
const outFile = join(root, "docs", "tools.md");
const check = process.argv.includes("--check");
if (!existsSync(entry)) {
  console.error("dist/index.js not found: run `npm run build` first");
  process.exit(2);
}
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// Empty .env so a developer's real ./.env is never read.
const tmp = mkdtempSync(join(tmpdir(), "gen-tools-doc-"));
const emptyEnv = join(tmp, "empty.env");
const dummyPem = join(tmp, "dummy.pem");
writeFileSync(emptyEnv, "");
writeFileSync(dummyPem, "x");

async function listTools({ groups, mutations, auth = "certificate", certs = true }) {
  const env = {
    QSEOW_ENV_PATH: emptyEnv,
    QSEOW_HOST: "qlik.example.invalid",
    QSEOW_AUTH_MODE: auth,
    QSEOW_TOOL_GROUPS: groups,
    QSEOW_ALLOW_MUTATIONS: String(mutations),
    ...(auth === "jwt" ? { QSEOW_JWT: "a.b.c" } : {}),
    ...(certs ? { QSEOW_CERT_PATH: dummyPem, QSEOW_CERT_KEY_PATH: dummyPem } : {}),
  };
  const transport = new StdioClientTransport({
    command: process.execPath, args: [entry], env, cwd: tmp, stderr: "ignore",
  });
  const client = new Client({ name: "gen-tools-doc", version: "0.0.0" });
  await client.connect(transport);
  try {
    const tools = [];
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : {});
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  } finally {
    await client.close();
  }
}

const ALL = "analyst,developer,admin";
let full, readOnly, jwtNoCerts;
const byGroup = {};
try {
  full = await listTools({ groups: ALL, mutations: true });
  readOnly = new Set((await listTools({ groups: ALL, mutations: false })).map((t) => t.name));
  jwtNoCerts = new Set((await listTools({ groups: ALL, mutations: true, auth: "jwt", certs: false })).map((t) => t.name));
  for (const g of ["analyst", "developer", "admin"]) {
    byGroup[g] = new Set((await listTools({ groups: g, mutations: true })).map((t) => t.name));
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const cell = (s) => String(s ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
const code = (s) => "`" + String(s).replace(/`/g, "'") + "`";
const GUID_RE = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

function resolve(schema, rootSchema) {
  if (!schema || !schema.$ref) return schema;
  const target = schema.$ref.replace(/^#\//, "").split("/").reduce((o, k) => o?.[decodeURIComponent(k)], rootSchema);
  const { $ref, ...rest } = schema;
  return { ...resolve(target, rootSchema), ...rest };
}

function typeOf(s, rootSchema) {
  s = resolve(s, rootSchema);
  if (!s) return "any";
  if (s.anyOf || s.oneOf) return (s.anyOf ?? s.oneOf).map((x) => typeOf(x, rootSchema)).join(" or ");
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(", ");
  if (s.type === "array") {
    const inner = typeOf(s.items, rootSchema);
    return / or |, /.test(inner) ? `array of (${inner})` : `${inner}[]`;
  }
  if (s.type === "string" && s.pattern === GUID_RE) return "GUID";
  return Array.isArray(s.type) ? s.type.join(" or ") : (s.type ?? "any");
}

function constraints(s) {
  const out = [];
  if (s.minimum !== undefined) out.push(`min ${s.minimum}`);
  if (s.exclusiveMinimum !== undefined) out.push(`> ${s.exclusiveMinimum}`);
  if (s.maximum !== undefined) out.push(`max ${s.maximum}`);
  if (s.minLength !== undefined) out.push(`min length ${s.minLength}`);
  if (s.maxLength !== undefined) out.push(`max length ${s.maxLength}`);
  if (s.minItems !== undefined) out.push(`min ${s.minItems} items`);
  if (s.maxItems !== undefined) out.push(`max ${s.maxItems} items`);
  if (s.pattern !== undefined && s.pattern !== GUID_RE) out.push(`pattern ${code(s.pattern)}`);
  if (s.default !== undefined) out.push(`default ${code(JSON.stringify(s.default))}`);
  return out;
}

function nestedObject(s, rootSchema) {
  s = resolve(s, rootSchema);
  if (!s) return undefined;
  if (s.type === "object" && s.properties) return { obj: s, suffix: "." };
  if (s.type === "array") {
    const inner = nestedObject(s.items, rootSchema);
    return inner ? { obj: inner.obj, suffix: "[]." } : undefined;
  }
  for (const b of s.anyOf ?? s.oneOf ?? []) {
    const inner = nestedObject(b, rootSchema);
    if (inner) return inner;
  }
  return undefined;
}

function rows(obj, rootSchema, prefix = "") {
  const out = [];
  const req = new Set(obj.required ?? []);
  for (const [name, raw] of Object.entries(obj.properties ?? {})) {
    const s = resolve(raw, rootSchema);
    const path = prefix + name;
    const desc = cell([s.description, ...constraints(s)].filter(Boolean).join("; "));
    out.push(`| ${code(path)} | ${cell(typeOf(s, rootSchema))} | ${req.has(name) ? "yes" : "no"} | ${desc} |`);
    const nested = nestedObject(s, rootSchema);
    if (nested) out.push(...rows(nested.obj, rootSchema, path + nested.suffix));
  }
  return out;
}

function annotationLine(a = {}) {
  const flags = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]
    .filter((k) => a[k] !== undefined)
    .map((k) => `${code(k)}: ${a[k]}`);
  return flags.length ? flags.join(", ") : "none";
}

const PERSONAS = [
  ["analyst", "Analyst", "Ask questions of app data through the Engine (QIX), plus the read-only troubleshooting tools: sheets, objects, expression search, master items, lineage."],
  ["developer", "Developer", "Load scripts, reloads and app lifecycle; the sheet and chart builder with its render-validation gate; master-item governance."],
  ["admin", "Admin", "Govern and operate the site through the Repository (QRS): inventory, tasks, reload forensics, engine health, security-rule audit, proxy sessions."],
];

const lines = [];
const L = (s = "") => lines.push(s);
const total = full.length;
const gated = full.filter((t) => !readOnly.has(t.name));
const certOnly = full.filter((t) => !jwtNoCerts.has(t.name));

L("# Tool reference");
L();
L(`<!-- Generated by scripts/gen-tools-doc.mjs from tools/list. Do not edit by hand: run \`npm run docs:tools\`. -->`);
L();
L(`SenseKit-MCP ${pkg.version} registers **${total} tools** when every group is enabled, mutations are allowed and certificate material is configured. ` +
  `With the default \`QSEOW_ALLOW_MUTATIONS=false\`, ${gated.length} of them are not registered at all, leaving ${total - gated.length}.`);
L();
L("Markers used below:");
L();
L("- **mutation-gated**: registered only when `QSEOW_ALLOW_MUTATIONS=true`. With the default, the tool is absent from `tools/list`.");
L("- **needs certificate files**: registered only when `QSEOW_CERT_PATH` and `QSEOW_CERT_KEY_PATH` are set, in any auth mode. These tools call the Proxy Service REST API, which accepts only certificate authentication.");
L("- **Inputs**: nested rows such as `measures[].label` describe the object form of an input; \"Required\" is relative to the parent object.");
L("- **Annotations** are the MCP tool hints the server declares (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). Clients can use them to apply their own confirmation policy.");
L();
L("Tool groups are chosen with `QSEOW_TOOL_GROUPS` (see [configuration.md](configuration.md)).");
L();
L("## Contents");
L();
for (const [g, title] of PERSONAS) {
  const names = full.filter((t) => byGroup[g].has(t.name)).map((t) => t.name);
  L(`- [${title}](#${title.toLowerCase()}) (${names.length}): ${names.map((n) => `[${code(n)}](#${n})`).join(", ")}`);
}
L();

for (const [g, title, blurb] of PERSONAS) {
  const tools = full.filter((t) => byGroup[g].has(t.name));
  L(`## ${title}`);
  L();
  L(`Group \`${g}\`. ${blurb}`);
  L();
  for (const t of tools) {
    L(`### ${t.name}`);
    L();
    const marks = [];
    marks.push(readOnly.has(t.name) ? "always registered with its group" : "**mutation-gated**");
    if (!jwtNoCerts.has(t.name)) marks.push("**needs certificate files**");
    L(`${marks.join(" · ")}`);
    L();
    L(cell(t.description));
    L();
    L(`Annotations: ${annotationLine(t.annotations)}`);
    L();
    const r = rows(t.inputSchema ?? {}, t.inputSchema ?? {});
    if (r.length) {
      L("| Input | Type | Required | Notes |");
      L("|---|---|---|---|");
      for (const row of r) L(row);
    } else {
      L("No inputs.");
    }
    L();
  }
}

L("## Summary");
L();
L(`- Mutation-gated (${gated.length}): ${gated.map((t) => code(t.name)).join(", ")}`);
L(`- Needs certificate files (${certOnly.length}): ${certOnly.map((t) => code(t.name)).join(", ") || "none"}`);
L();

const doc = lines.join("\r\n");
if (check) {
  const current = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
  // git checkout may normalize CRLF to LF.
  const norm = (t) => t.replace(/\r\n/g, "\n");
  if (norm(current) !== norm(doc)) {
    console.error("docs/tools.md is out of date: run `node scripts/gen-tools-doc.mjs`");
    process.exit(1);
  }
  console.log(`docs/tools.md is current (${total} tools)`);
} else {
  writeFileSync(outFile, doc);
  console.log(`wrote docs/tools.md: ${total} tools, ${gated.length} mutation-gated, ${certOnly.length} need certificate files`);
}
