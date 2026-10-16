# Contributing

Issues and pull requests are welcome. This page covers the development setup, the rules the code follows, and what a change needs before it can be merged.

## Ground rules

- **No secrets, ever.** No real hostnames, certificates, tokens, connection strings or customer data in code, fixtures, tests, issues or pull requests. Fixtures are synthetic.
- **One behavior change per pull request**, with the reason in the commit message.
- **Don't claim what you haven't verified.** If a chart shape has not been rendered in a browser, it stays marked `renderVerified: false` and the docs say so.
- Report security problems privately, as described in [SECURITY.md](SECURITY.md).

## Development setup

You need Node.js 20 or later and npm.

```bash
npm install          # also builds dist/ (the "prepare" script)
npm run build        # clean + tsc -> dist/
npm run typecheck    # tsc --noEmit
npm test             # build, then run every suite under tests/
npm run test:unit    # build, then only tests/unit (pure logic, no server)
npm run test:tools   # build, then only tests/tools (every tool through a real MCP client)
npm run coverage     # build, then all suites with coverage (Node 22+); writes coverage/lcov.info
npm run docs:tools   # build, then regenerate docs/tools.md
npm run docs:check   # check that docs/tools.md is current (run after a build)
npm run dev          # run src/index.ts directly with tsx
```

There is no lint script; `npm run typecheck` is the static check.

The test scripts use `scripts/run-tests.mjs`. It finds `tests/**/*.test.mjs` itself, so it works the same in Windows `cmd` (which does not expand globs) and on Node 20, 22 and 24. You can call it directly to pick suites or pass flags through to Node, for example `node scripts/run-tests.mjs tools -- --test-name-pattern=gating`.

Tests import from `dist/`, and `build` starts by deleting `dist/`. Don't start a build while tests are running.

To run the server against a site from source:

```bash
cp .env.example .env     # fill in host and auth; see docs/configuration.md
node dist/index.js       # stdio MCP server
```

## Tests

`npm test` builds and runs all suites with Node's built-in test runner. It needs no Qlik site and no network.

| Folder | What it holds |
|---|---|
| `tests/unit/` | Unit tests for pure functions in `core/`, `qix/` and `viz/`, one file per module (`viz.props.test.mjs` tests `src/viz/props.ts`, and so on). Shared helper: `tests/unit/_helpers.mjs`. |
| `tests/tools/` | One file per tool group (`server.gating`, `tools.admin`, `tools.ops`, `tools.analyst`, `tools.inspector`, `tools.developer`, `tools.builder`, `tools.master`). Each drives the real `createServer()` through a real MCP client over the SDK's in-memory transport, against fake clients. `server.gating` checks `tools/list` and annotations for every combination of groups, mutations and certificates. |
| `tests/helpers/` | Reuse these instead of writing new fakes (see below). |
| `tests/fixtures/` | Synthetic QRS and QIX payloads, including secret-bearing ones for the redaction tests. |

The helpers:

- `harness.mjs`: `startServer({ groups, allowMutations, cert, engineOptions, qrsOptions })` returns `{ call, callApp, tools, doc, qrs, close }`. Assertions:
  - `ok(res)` asserts success and parses the JSON.
  - `expectToolError(res, { code, messageIncludes?, details? })` asserts a structured error. `code` is required and must be one of the ten codes; `details` is matched as a subset.
  - `expectSdkError(res, text)` is for errors the MCP SDK raises before any handler runs (an unknown tool, or a mutating tool on a read-only server).
  - `expectInvalidArgs(res, param)` is for input-schema (zod) errors.
- `fake-engine.mjs`: a small working QIX engine over four data rows. It supports selections, hypercubes and list objects, `CheckExpression`, persistent objects, master items, the script and reloads. Inspect its state through `h.doc.objects`, `measures`, `dimensions`, `script`, `saves` and `reloads`.
- `fake-qrs.mjs`: a fixed site (apps, streams, tasks, secrets, security rules). Add extra or failing routes with `{ routes }`; `h.qrs.calls` records the requests.
- `inventory.mjs`: the tool contract table (name, group, mutating, destructive, certificate-only, session) and `ERROR_CODES`. The gating test fails if the error codes in `src/core/errors.ts` drift from this list.
- `loopback-https.mjs`: `startLoopbackHttps(handler)`, `startDroppingServer()` and `loopbackConfig(port, opts)` run a real HTTPS server on 127.0.0.1. It serves the tools that bypass the QRS client (`engine_healthcheck`, `list_user_sessions`, `end_user_sessions`). Its self-signed certificate and key are embedded in the file and are **test-only**: they protect nothing and are safe to ignore if a secret scanner flags them. They live in a `.mjs` file because `.gitignore` excludes `*.pem`.
- `seed.mjs`: seeds a sheet, charts and master items into the fake app.

To test failure paths, pass overrides to `startServer`:

- `engineOptions: { docOverrides, globalOverrides, objectOverrides, scriptErrors, reloadResult }`. Each `*Overrides` is a set of methods merged onto the fake Doc, the fake Global, or every fake GenericObject.
- `qrsOptions: { routes: [[method, regex, handler]] }`. A handler that throws simulates an HTTP error; `qrsHttpError(status, method, path, body)` from `fake-qrs.mjs` builds exactly the error the real QRS client raises.
- `qixError(message, code)` from `fake-engine.mjs` builds an engine (enigma.js) rejection with a numeric engine error code.

For deeper unit runs you can point `QPROP_FIXTURE_DIR` at a directory of recorded object properties (`qProps`). Such recordings come from a real site and are never committed.

Tests that need a live site are scripts, not part of `npm test`:

| Script | Needs | What it does |
|---|---|---|
| `npm run smoke` (`scripts/smoke.mjs`) | a live site, `QSEOW_ALLOW_MUTATIONS=true` | Starts the server and exercises admin, developer and analyst tools on a small demo app. |
| `scripts/viz_matrix.mjs` | a live site, `QSEOW_ALLOW_MUTATIONS=true` | Builds one object of every original chart type through `add_sheet_object`, runs the gate on each, and checks four refusal paths. |
| `scripts/render_proof.mjs` | a live site with a JWT virtual proxy, Playwright | Renders objects in a headless browser and takes screenshots. See [docs/chart-building.md](docs/chart-building.md#verifying-rendering-with-render_proofmjs). |
| `examples/*/trace.mjs` | a live site, `QSEOW_ALLOW_MUTATIONS=true` | The demo traces, with assertions. See [examples/README.md](examples/README.md). |

Run these against a sandbox site, never production: they create, change and delete apps.

### CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:

- a matrix of `ubuntu-latest` and `windows-latest` on Node 20, 22 and 24 (fail-fast off): `npm ci`, `npm run typecheck`, `npm run build`, `npm test`, then `npm pack --dry-run --ignore-scripts`. The pack step fails if `dist/index.js`, `dist/server.js` or `dist/tools/index.js` is missing from the tarball, or if `src/`, `tests/` or `scripts/` would be published;
- `npm run docs:check` on the Ubuntu / Node 24 leg;
- a coverage job (Ubuntu, Node 24) that writes the coverage table to the job summary and uploads `coverage/` as an artifact.

The live-site scripts above are not run in CI.

## Code layout and rules

The source is split into layers: `clients/`, `core/`, `qix/`, `viz/` and `tools/`. [docs/architecture.md](docs/architecture.md) describes each one and the request flow. The rules that keep it testable:

- Imports only point downwards, with no cycles: `core/` imports nothing internal; `clients/` imports `config.ts`, `core/` and types from `qix/types.ts`; `qix/` imports `core/`; `viz/` imports `core/`, `qix/` and client types; `tools/` may import everything. `qix/` never imports `clients/`, `viz/` or `tools/`, and `viz/` never imports `tools/`. `tests/unit/architecture.test.mjs` enforces these rules (and that every relative import resolves), so a violation fails `npm test`.
- Throw `ToolError` (from `core/errors.ts`) with the right code instead of a plain `Error`; the error boundary does the rest. Don't add per-tool try/catch for reporting.
- Only `clients/` opens network connections. Tool handlers receive clients through `ToolDeps` and never construct them.
- `server.ts` is pure wiring with no I/O.
- Logic goes into `core/`, `qix/` or `viz/` as plain functions, so it can be unit-tested without a server.

## Tool conventions

- Read-only tools use the `READ` annotations from `core/annotations.ts`.
- Mutating tools are registered **only** when `QSEOW_ALLOW_MUTATIONS=true`, and carry a truthful `destructiveHint`.
- App and task ids use the `guid` schema from `core/schemas.ts`.
- List tools are paged with `core/paging.ts` (`offset`/`limit`, envelope `{ total, offset, returned, truncated, items }`).
- Anything that can carry credentials goes through `core/redact.ts` before it is returned.
- Refuse bad input before writing anything, and say why.
- Errors use the structured shape described in [docs/errors.md](docs/errors.md).

### Adding a tool

Follow the steps in [docs/architecture.md](docs/architecture.md#adding-a-tool). In addition:

1. Add the tool to `tests/helpers/inventory.mjs`. The gating and annotation tests compare `tools/list` with that table exactly, so they fail until the entry exists.
2. Add tests to its group's `tests/tools/tools.<group>.test.mjs`: the success shape, every refusal path (each asserting that nothing was changed), and redaction if it returns QRS, script or object data.
3. A mutating tool must be registered only when mutations are allowed, with the correct `destructiveHint`.
4. Regenerate the tool reference and commit it:

   ```bash
   npm run docs:tools
   ```

   CI runs `npm run docs:check`, which fails if `docs/tools.md` is out of date.

5. If you touched tool behavior, run `npm run smoke` against a live site, in both auth modes if you can, and say in the pull request what you ran.

### Adding a chart type

Follow the steps in [docs/architecture.md](docs/architecture.md#adding-a-chart-type). The tests it needs:

1. Unit cases in `tests/unit/viz.specs.test.mjs` and `tests/unit/viz.props.test.mjs` for its shape limits and built properties (and in `viz.options.test.mjs` for any options it supports).
2. A row in the shape table of the test "every supported visualization type builds something its own gate accepts" in `tests/tools/tools.builder.test.mjs`. The new type must pass its own validation gate.

### Render proof for new chart shapes

Any change that alters what the builder writes for a chart (a new type, a new option, a new input form, or a change to an existing property tree) needs a **render proof** before it can be called verified:

1. Build the affected objects on a live site.
2. Run `scripts/render_proof.mjs` with `SHOTS=<dir>` and look at every screenshot, at both tile sizes.
3. In the pull request, state the Qlik Sense version and what you looked at, and attach or describe the screenshots.

Without a render proof, the change can still be merged, but the type keeps `renderVerified: false` (or the option stays listed as unverified in [docs/chart-building.md](docs/chart-building.md#verification-status)). Do not change string-input property trees that were render-verified upstream unless you also render-prove the result.

## Documentation

- `docs/tools.md` is generated. Do not edit it by hand.
- If you add or change an environment variable, update [docs/configuration.md](docs/configuration.md), [.env.example](.env.example), [server.json](server.json) and, if users set it in Claude Desktop, [mcpb/manifest.template.json](mcpb/manifest.template.json).
- Record user-visible changes in [CHANGELOG.md](CHANGELOG.md).

## License

By contributing, you agree that your contributions are licensed under the Apache License 2.0, as described in [LICENSE](LICENSE).
