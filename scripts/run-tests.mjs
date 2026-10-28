#!/usr/bin/env node
// Usage: node scripts/run-tests.mjs [suite...] [--coverage] [-- node flags]
// Own glob: Windows cmd doesn't expand globs; node --test globbing differs by version.
import { spawn } from "node:child_process";
import { readdirSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TESTS = join(ROOT, "tests");

function findTests(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTests(p));
    else if (entry.name.endsWith(".test.mjs")) out.push(p);
  }
  return out;
}

const argv = process.argv.slice(2);
const dashdash = argv.indexOf("--");
const own = dashdash >= 0 ? argv.slice(0, dashdash) : argv;
const passthrough = dashdash >= 0 ? argv.slice(dashdash + 1) : [];

const suites = own.filter((a) => !a.startsWith("-"));
const coverage = own.includes("--coverage");
passthrough.unshift(...own.filter((a) => a.startsWith("-") && a !== "--coverage"));

const roots = suites.length ? suites.map((s) => join(TESTS, s)) : [TESTS];
for (const r of roots) {
  if (!existsSync(r) || !statSync(r).isDirectory()) {
    console.error(`run-tests: no such test suite: ${relative(ROOT, r)}`);
    process.exit(2);
  }
}
const files = roots.flatMap(findTests).sort().map((f) => relative(ROOT, f));
if (!files.length) {
  console.error(`run-tests: no *.test.mjs files under ${roots.map((r) => relative(ROOT, r)).join(", ")}`);
  process.exit(2);
}
if (!existsSync(join(ROOT, "dist", "server.js"))) {
  console.error("run-tests: dist/ is missing. Run `npm run build` first (npm test does this for you).");
  process.exit(2);
}

const nodeArgs = ["--test"];
if (coverage) {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) {
    console.error(`run-tests: --coverage needs Node >= 22 (this is ${process.versions.node}).`);
    process.exit(2);
  }
  mkdirSync(join(ROOT, "coverage"), { recursive: true });
  nodeArgs.push(
    "--experimental-test-coverage",
    "--test-coverage-include=dist/**",
    "--test-reporter=spec", "--test-reporter-destination=stdout",
    "--test-reporter=lcov", `--test-reporter-destination=${join("coverage", "lcov.info")}`,
  );
}

const child = spawn(process.execPath, [...nodeArgs, ...passthrough, ...files], { cwd: ROOT, stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 1));
