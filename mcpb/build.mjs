#!/usr/bin/env node
// Build the Claude Desktop bundle (.mcpb): a one-double-click install that
// prompts for host + certificate paths instead of hand-edited JSON.
//
// Claude Desktop ships a Node runtime, so the bundle carries dist/ plus the
// PRODUCTION dependency tree — the client does not run npm install.
//
//   node mcpb/build.mjs      ->  mcpb/qlik-sense-mcp-<version>.mcpb
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, cpSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const stage = join(here, "build");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

// 1. dist must be current — the bundle ships compiled output, not sources.
run("npm", ["run", "build"], root);

// 2. clean stage
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "server"), { recursive: true });

// 3. compiled server
cpSync(join(root, "dist"), join(stage, "server"), { recursive: true });

// 4. production deps only, installed INTO the bundle
writeFileSync(join(stage, "package.json"), JSON.stringify({
  name: pkg.name, version: pkg.version, private: true, type: "module",
  dependencies: pkg.dependencies,
}, null, 2));
run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], stage);

// 5. manifest, version stamped from package.json so they can never drift
const manifest = JSON.parse(readFileSync(join(here, "manifest.template.json"), "utf8"));
manifest.version = pkg.version;
writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2));

// 6. docs the user sees inside the bundle
for (const f of ["README.md", "LICENSE", "NOTICE"]) {
  if (existsSync(join(root, f))) cpSync(join(root, f), join(stage, f));
}

// 7. validate, then pack
run("npx", ["-y", "@anthropic-ai/mcpb", "validate", join(stage, "manifest.json")], root);
const out = join(here, `${pkg.name}-${pkg.version}.mcpb`);
rmSync(out, { force: true });
run("npx", ["-y", "@anthropic-ai/mcpb", "pack", stage, out], root);
console.log(`\nbundle: ${out}`);
