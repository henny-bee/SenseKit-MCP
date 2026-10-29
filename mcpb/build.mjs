#!/usr/bin/env node
// Bundle carries prod node_modules: Claude Desktop has Node but never runs npm install.
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, rmSync, cpSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const stage = join(here, "build");
// Windows: npm and npx are .cmd files, which Node only starts through a shell; quote args for paths with spaces.
const run = (cmd, args, cwd) => process.platform === "win32"
  ? execSync([cmd, ...args.map((a) => `"${a}"`)].join(" "), { cwd, stdio: "inherit" })
  : execFileSync(cmd, args, { cwd, stdio: "inherit" });

run("npm", ["run", "build"], root);

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "server"), { recursive: true });

cpSync(join(root, "dist"), join(stage, "server"), { recursive: true });

writeFileSync(join(stage, "package.json"), JSON.stringify({
  name: pkg.name, version: pkg.version, private: true, type: "module",
  // Optional ones too: playwright-core gives Claude Desktop users render_sheet (it uses the installed browser).
  dependencies: { ...pkg.dependencies, ...pkg.optionalDependencies },
}, null, 2));
run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], stage);

const manifest = JSON.parse(readFileSync(join(here, "manifest.template.json"), "utf8"));
manifest.version = pkg.version;
writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2));

for (const f of ["README.md", "LICENSE", "NOTICE"]) {
  if (existsSync(join(root, f))) cpSync(join(root, f), join(stage, f));
}

run("npx", ["-y", "@anthropic-ai/mcpb", "validate", join(stage, "manifest.json")], root);
const out = join(here, `${pkg.name}-${pkg.version}.mcpb`);
rmSync(out, { force: true });
run("npx", ["-y", "@anthropic-ai/mcpb", "pack", stage, out], root);
console.log(`\nbundle: ${out}`);
