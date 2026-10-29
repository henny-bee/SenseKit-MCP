# Changelog

All notable changes to SenseKit-MCP are recorded here.

## 1.0.1 — 2026-10-29

- The Claude Desktop bundle (`.mcpb`) now includes `playwright-core`, so `render_sheet` is available there too, in windows and jwt mode. It still downloads no browser: it uses the installed Edge, or Chrome outside Windows. The bundle grows from 3.4 MB to 6.2 MB.

## 1.0.0 — 2026-10-29

First release of **SenseKit-MCP**, a substantially modified fork of [qseow-mcp](https://github.com/rmterenzi/qseow-mcp) 0.5.2 by Terenzi LLC (Apache-2.0). See [NOTICE](NOTICE). The entries below describe what changed compared with qseow-mcp 0.5.2.

### Naming and packaging

- The npm package, the `bin` command, the MCP server name, the MCP Registry name (`io.github.henny-bee/sensekit-mcp`) and the Claude Desktop bundle (`sensekit-mcp-<version>.mcpb`) are now `sensekit-mcp`, and the project is called **SenseKit-MCP**. The identifiers are lowercase because npm package names cannot contain capital letters.
- **Unchanged on purpose:** all `QSEOW_*` environment variables and all tool names. Existing client configurations only need the new package or command name.
- `server.json` now lists every environment variable the server reads, including the ports, `QSEOW_CERT_PASSPHRASE`, the certificate identity, `QSEOW_JWT_PATH` and `QSEOW_ENV_PATH`.
- `npm run bundle` now also works on Windows, where `npm` and `npx` are `.cmd` files that Node starts only through a shell. The bundle carries the regular dependencies only, so `render_sheet` (which needs the optional `playwright-core`) is not in it.

### Windows login (no certificates)

- New auth mode `QSEOW_AUTH_MODE=windows`: signs in through the proxy's Windows login form (`/internal_forms_authentication/`) with `QSEOW_USERNAME` (`DOMAIN\user`) and `QSEOW_PASSWORD` or `QSEOW_PASSWORD_PATH`, then runs on one cached session cookie like jwt mode. It needs no certificates and no Qlik admin changes. See [docs/authentication.md](docs/authentication.md#windows-mode).
- A rejected login is not retried until the server restarts, so a wrong password cannot lock the Windows account. Login redirects that leave the configured host and port are refused before the password is sent.
- `QSEOW_VP_PREFIX` may be empty for the unprefixed default proxy; this is the default in windows mode.
- Through a virtual proxy, a redirect from QRS or the engine health check (the login page after a session expired) is treated like a 401: the session is renewed and the call retried once. Before, a QRS redirect was returned as if it were data.
- The engine WebSocket URL omits `qlik-csrf-token` when the proxy issued none (releases without CSWSH protection).

### Builder extensions

- Dimensions and measures accept an object form in addition to plain strings:
  - dimensions: `{ field | expression | libraryId, label?, sort? }`, which adds calculated dimensions, labels, sort order and links to master dimensions;
  - measures: `{ expression | libraryId, label?, numberFormat?, color? }`, which adds labels, number formats, per-measure colors and links to master measures.
- Number formats: `auto`, `number`, `integer`, `percent`, `money`, `date` and `custom`, with optional pattern and decimals.
- Chart `options`: `colorMode` and `color`, `showLegend`, `showDataLabels`, `orientation` and `stacked` (bar chart), and `sortByMeasure`. Options that do not apply to a type are ignored and reported in the response's `notes`.
- New visualization type `filterpane` (one listbox child per dimension).
- Null and zero rows: `includeNulls: false` on a dimension hides its null (`-`) row (`qNullSuppression`), and `options.includeZeros: false` hides rows whose measures are all zero (`qSuppressZero`), like the client's **Include null values** and **Include zero values** checkboxes.
- Pivot columns: `pivotColumn: true` on the trailing dimensions of a `pivot-table` puts them across the top. Before, every pivot dimension was a row.
- Combo chart series: `series: { type: bar | line | marker, axis: primary | secondary }` on a `combochart` measure, with a second measure axis when one is used. Combo chart measure colors are now written the way the client writes them for a combo chart (`qDef.color`). Both follow a client-authored combo chart.
- `update_sheet_object` carries `includeNulls`, `pivotColumn`, `series` and combo colors over when dimensions or measures are omitted.
- New visualization type `action-button` (the client's Button) for navigation: `options.navigateTo` goes to a sheet, the next, previous, first or last sheet, or a website; `title` is the label and `options.color` the background. A target sheet that does not exist is refused before writing, and the gate fails a button whose target sheet was deleted. Updates keep a button's navigation and its client-set actions. The properties follow the button supernova's own defaults.
- New visualization types `bulletchart`, `boxplot`, `histogram`, `distributionplot`, `waterfallchart` and `mekkochart`. The bullet chart follows a client-authored one, the others the default property sets of their `@nebula.js/sn-*` packages. New measure fields: `target` (bullet chart) and `operation` and `subtotal` (waterfall). `orientation` also applies to the bullet chart, box plot and distribution plot. The box plot's cube is stored under `boxplotDef`, as the client does, and the gate and `update_sheet_object` read it there. Types can now restrict `colorMode` and add a shape rule (the bullet chart takes one measure when it has a dimension).
- Colors seen in the browser: the bullet chart's custom bar color now lands in `color.paletteColor`, the key the client draws (the documented `color.bar` is never read), and a bullet chart with a dimension shares one axis across its rows. The waterfall chart takes `colorMode` `single` for its positive bars (custom colors need `color.auto` off), and a single-color box plot colors its outlier points too.
- New measure field `colorBands` for the KPI: color the value by thresholds (for example red below 0, green from 0) or give it one fixed color. Mirrors the `conditionalColoring` of client-authored KPIs, works on master measures, and survives `update_sheet_object`.
- New read-only tool `render_sheet`: opens a sheet in a headless browser with the server's own proxy session and returns a 1600 × 900 screenshot plus a status per object (`renders`, `blank`, `error`, `not-rendered`, `missing`). Registered in windows and jwt mode when the optional dependency `playwright-core` is installed; uses the installed Edge or Chrome (`QSEOW_BROWSER`), downloads no browser.
- Plain string inputs still produce the same definitions as before.
- None of these additions is render-verified yet. See [docs/chart-building.md](docs/chart-building.md#verification-status).

### Object lifecycle

- `update_sheet_object` rebuilds a builder-supported object in place and runs the gate again. Omitted title, dimensions and measures are carried over; options are not merged.
- `move_sheet_object` moves or resizes an object's cell, or places an unplaced object.
- `delete_sheet_object` deletes an object with its children and removes its cell.

### Master items

- `create_master_measure`: the expression is checked first and refused on any error or unknown field; duplicate titles are refused; optional number format.
- `create_master_dimension`: single or drill-down; fields are checked against the data model.
- `delete_master_item`: finds every object linked to the item and refuses while any exist, unless `force: true`.

### Validation gate

- Pre-flight refusals now also cover calculated-dimension expression findings, measure syntax errors and unknown master-item ids.
- New gate checks: links to master items that do not exist, calculated dimensions and calculated listboxes, filterpane children (findings lifted onto the pane), and a warning on types that are not render-verified.
- During one gate run the master-item list is read once, not once per object.

### Fixes

- **jwt mode: expired proxy sessions recover.** If the proxy rejects the cached session (401 or 403 from QRS, 401 or 403 on the engine WebSocket upgrade, or the engine socket closing at open), the server bootstraps a new session and retries the operation once. Concurrent calls share one re-bootstrap. A 403 or a socket closed at open is only retried when the session is older than 60 seconds, so security-rule denials are not retried. Previously the server had to be restarted.
- **`QSEOW_ROOT_CERT_PATH` works in every mode.** The CA is loaded with or without client-certificate files and trusted on every TLS connection, including the virtual proxy in jwt mode, where it was previously ignored.
- **Parallel writes to one app no longer collide.** Mutating calls on the same app (builder, master items, `set_script`, `reload_app`) now run one at a time. In parallel, two `add_sheet_object` calls on one sheet could drop one object's cell, and concurrent saves failed with `Write Failed`; an object created but never saved was lost when the engine session closed.
- **Saves retry `Write Failed`.** A save that fails with engine error 9000 is retried up to three times. If it still fails, the `ENGINE_ERROR` says the change is not saved and how many attempts were made.
- **`.env.example` works when copied.** The `.env` loader keeps everything after `=`, so the example's end-of-line comments became part of the host and port values. Its pre-filled certificate paths also stopped any setup without those files, and `QSEOW_VP_PREFIX=jwt` sent windows logins to the `/jwt` proxy. Comments are now on their own lines and optional values are empty. The `.env` snippets in `docs/authentication.md` are fixed the same way, and `docs/configuration.md` states the comment rule.
- **Auto-placement no longer overlaps tiles.** When the usual slot would overlap an earlier, taller tile (for example a fourth tile after an 8 × 6 pie chart), the tile goes to the first free 8-column-aligned slot instead. Sheets of plain 8 × 4 tiles are laid out as before.
- **`scripts/render_proof.mjs`:** screenshots are named `<size>-<NN>-<viz>-<objectId>.png`, so objects of the same type no longer overwrite each other. The script now exits 1 unless every object rendered at every size, and ends with a summary of the objects that were not proven.

### Structure, typing and performance

- `src/` is split into layers: `clients/` (QRS, Engine, Proxy), `core/` (pure helpers), `qix/` (engine-side helpers), `viz/` (chart definitions and the gate) and `tools/` (MCP tool registration), with `server.ts` as pure wiring and `index.ts` as the CLI entry. See [docs/architecture.md](docs/architecture.md).
- Chart types are a registry: one file per type in `src/viz/types/` implementing a shared contract. Shape limits, tile sizes, option applicability and nebula.js handling are derived from it. Adding a type means one file plus one registry line.
- Typed interfaces for the subset of the Engine (QIX) and QRS APIs the server uses; `src/` has no bare `any` (99 before).
- Up to 8 engine requests run concurrently within one tool call, with results kept in order.
- `validate_sheet` and the reference scan in `delete_master_item` read whole sheets with `GetFullPropertyTree` instead of object by object. On a mock engine with 3 ms per call (not a live site): `validate_sheet` on 12 objects went from 65 to 48 engine calls (995 ms to 219 ms), and `delete_master_item` over 215 objects from 462 to 29 calls (7.1 s to 0.15 s).
- The installed-extension list used by the gate is cached for 5 minutes per host. An extension installed within that window can briefly be reported as an unknown visualization.

### Errors

- Tool failures return `isError: true` with JSON text `{ code, message, details? }`, redacted, produced by one error boundary around every tool. Codes: `INVALID_INPUT`, `NOT_FOUND`, `VALIDATION_REFUSED`, `REFERENCED`, `CONFLICT`, `ENGINE_ERROR`, `QRS_ERROR`, `PROXY_ERROR`, `AUTH_ERROR`, `INTERNAL`. See [docs/errors.md](docs/errors.md).
- Message wording is unchanged, so scripts that match phrases such as `refusing to create:` keep working.
- Input-schema violations still return the MCP SDK's own `Input validation error` text.

### Tests and CI

- Unit tests for the `core`, `qix` and `viz` modules, and tool-level tests that drive every tool through a real MCP client against in-memory fakes of the Engine and QRS. Nothing needs a live site or network.
- A `tools/list` contract test covering every combination of tool groups, mutations and certificate material, including annotations.
- An architecture test that enforces the layer rules, forbids import cycles and checks that every relative import resolves.
- New npm scripts: `test:unit`, `test:tools`, `typecheck`, `coverage`, `docs:tools` and `docs:check`. A cross-platform test runner (`scripts/run-tests.mjs`) lets the tests run under Windows `cmd`.
- GitHub Actions on Ubuntu and Windows with Node 20, 22 and 24: typecheck, build, tests, a check that `docs/tools.md` is current, and an `npm pack` content check. A separate job collects coverage.

### Documentation

- New `docs/`: architecture, a tool reference generated from the real `tools/list` (`scripts/gen-tools-doc.mjs`), configuration, authentication, chart building and errors.
- The demo runbooks in `examples/` are kept and point to the new docs.
- Removed the upstream commercial-support material.
