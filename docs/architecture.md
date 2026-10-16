# Architecture

qlik-sense-mcp is a stdio [Model Context Protocol](https://modelcontextprotocol.io) server written in TypeScript (Node.js 20 or later). It turns three Qlik Sense Enterprise on Windows APIs into MCP tools:

- the **Repository Service (QRS)** REST API, for site inventory and governance;
- the **Engine (QIX)** JSON-RPC API over WebSocket (through enigma.js), for app data, objects and the builder;
- the **Proxy**: the JWT virtual proxy in jwt mode, and the Proxy Service REST API for user sessions.

## Layers

```
src/
  index.ts      CLI entry: load config, build clients, create server, serve stdio
  config.ts     environment variables -> typed Config
  server.ts     createServer(deps): pure wiring, no I/O
  clients/      the only code that talks to the network
  core/         pure helpers, no Qlik connection needed
  qix/          engine-side helpers and typed QIX interfaces
  viz/          chart definitions, input normalization, the validation gate
  tools/        MCP tool registration, one module per area
```

| Layer | Contents |
|---|---|
| `clients/` | `qrs.ts` (QRS REST, fresh `xrfkey` per request, one retry on a dropped socket), `engine.ts` (QIX session manager), `proxy-session.ts` (jwt-mode CSRF and session bootstrap), `raw-https.ts` (engine health check and Proxy Service API), `qrs-types.ts` (typed QRS entities). |
| `core/` | Redaction, paging, QRS filter quoting, status codes, security-rule decoding, lineage classification, log tails, health-check flattening, JSON walking, input schemas (GUID), tool annotations, result and error helpers, bounded concurrency (`pool.ts`) and a TTL cache (`cache.ts`). |
| `qix/` | Typed interfaces for the subset of the Engine API the server calls (`types.ts`), object and sheet walks and master-item references (`objects.ts`), expression and field checks and the master-item index (`quality.ts`), and building selection values (`selection.ts`). |
| `viz/` | The chart-type registry (`types/`, one file per type), shared building blocks for the per-type builders (`build.ts`), input normalization (`inputs.ts`), number formats, styling options (`options.ts`), the build dispatch (`props.ts`), shape specs derived from the registry (`specs.ts`), reading an existing object back into inputs (`read-back.ts`), grid layout and placement checks (`layout.ts`), pre-flight and creation (`definition.ts`), the validation gate (`validate.ts`) and the tool input schemas the builder shares (`schemas.ts`). |
| `tools/` | `admin.ts`, `ops.ts` (admin group); `analyst.ts`, `inspector.ts` (analyst group); `developer.ts`, `builder.ts`, `master.ts` (developer group); `index.ts` (registration and group gating); `error-boundary.ts` (turns every thrown error into a structured tool error). |

### Dependency rules

Imports only point downwards, and there are no import cycles:

| Layer | May import |
|---|---|
| `core/` | nothing inside `src/` |
| `qix/` | `core/`; never `clients/`, `viz/` or `tools/`. `qix/types.ts` imports nothing. |
| `clients/` | `config.ts`, `core/`, other `clients/`, and `qix/types.ts` as `import type` only |
| `viz/` | `core/`, `qix/`, and types from `clients/`; never `tools/` |
| `tools/` | `core/`, `qix/`, `viz/`, `clients/`, `config.ts`; never `server.ts` or `index.ts` |
| `server.ts` | `tools/` (only `server.ts` and `index.ts` may import `tools/index.ts`) |
| `index.ts` | `config.ts`, `clients/`, `server.ts` |

These rules are enforced by `tests/unit/architecture.test.mjs`, which runs with `npm test`. It parses every import in `src/` (static, `import type`, side-effect and dynamic) and fails with the offending file and import, or the full cycle path. It also checks that every relative import resolves, including those in `scripts/`, `examples/`, `tests/` and `mcpb/`.

The typed Engine interfaces live in `qix/types.ts`. enigma.js has no type package here, so `EngineClient` casts its handles to these interfaces once, at the boundary. Qlik property trees are open by design, so the interfaces type the keys the code touches and keep an index signature for the rest. `src/` contains no bare `any`.

Consequences:

- Nothing below `tools/` knows about MCP. `core/`, `qix/` and `viz/` are plain functions over plain data or an engine handle, which is why they can be unit-tested without a server or a site.
- Only `clients/` opens sockets. Tool handlers get clients through `ToolDeps` (`{ cfg, engine, qrs, session? }`) and never construct them, so tests can wire the whole tool surface against fakes.
- `createServer()` does no I/O. `index.ts` is the only place that connects a transport.

## Startup and registration

1. `index.ts` calls `loadConfig()` (`config.ts`), which reads `.env` if present and the environment, and fails fast on missing or invalid auth settings.
2. In jwt mode it creates one `ProxySession`. It then creates the `QrsClient` and `EngineClient`. None of them connects yet.
3. `createServer()` creates the `McpServer` (named `qlik-sense-mcp`), installs the error boundary, and calls `registerTools()`.
4. `registerTools()` (`tools/index.ts`) applies **group gating**: each group's modules are registered only if the group is in `QSEOW_TOOL_GROUPS`. This is the only place that checks groups.
5. Each module applies **mutation gating** itself, next to the tools it hides: a mutating tool is registered only when `cfg.allowMutations` is true. The certificate-only session tools also check that certificate material is configured.
6. The server connects a stdio transport and prints one status line to stderr.

Registration order is the `tools/list` order. Because gating happens at registration, a read-only deployment does not just refuse write calls; it never advertises the tools.

## Request flow

For a call such as `evaluate_expression`:

1. The MCP SDK receives `tools/call` over stdio and validates the arguments against the tool's zod schema. Invalid input is rejected before the handler runs.
2. The handler asks `EngineClient.app(appId)` for the app. The app id must be a GUID (checked again here, because it ends up in the WebSocket path).
3. `EngineClient` keeps **one WebSocket session per app**, because a QIX socket can hold only one open document, plus one session without an app (`engineData`) for global calls such as the document list and `createApp`. Each app's document handle is cached, so selections persist across tool calls. Before reuse it is checked with a cheap call; sessions idle for more than 5 minutes are closed.
4. In jwt mode, every socket and every QRS call reuses the one session cookie that `ProxySession` bootstrapped (see [authentication.md](authentication.md#the-engine-websocket-and-cswsh-protection)).
5. The handler calls helpers from `qix/`, `viz/` and `core/`. Work that fans out over many objects runs with at most 8 engine requests in flight per tool call (`core/pool.ts`), and results keep their input order. Whole-sheet reads in `validate_sheet` and the reference scan in `delete_master_item` read each sheet's full property tree in one request (`GetFullPropertyTree`) instead of object by object.
6. The result passes through redaction where it can contain credentials, and is returned as JSON text content (`core/result.ts`).
7. If the handler throws, the error boundary (`tools/error-boundary.ts`) turns it into `isError: true` with a redacted `{ code, message, details? }` payload. Clients and helpers throw `ToolError` with a code; any other `Error` becomes `ENGINE_ERROR` (if it carries an engine error code) or `INTERNAL`. See [errors.md](errors.md).

QRS calls follow the same shape through `QrsClient`: certificate mode calls `:4242` directly with the client certificate and the `X-Qlik-User` header; jwt mode calls the same paths under the virtual proxy prefix on `QSEOW_PROXY_PORT`.

## The render-validation gate

The builder's central problem: the engine accepts and saves many definitions that the Qlik client then draws as nothing or as an error. Modern Sense charts are nebula.js supernovas that run in the browser, so the engine never learns that a chart failed. The gate checks, from the engine side, the failure modes that are known to produce a blank or broken tile.

`add_sheet_object` runs in this order:

1. **Pre-flight** (`viz/definition.ts` `prepareDefinition`): normalize inputs (`viz/inputs.ts`), resolve options (`viz/options.ts`), check the shape against the type's spec, check dimension fields against the data model, check calculated dimensions and measure syntax with the engine, and check master-item ids. Anything that fails here is refused before the app is touched.
2. **Build** (`viz/props.ts` dispatches to the type's `build` in `viz/types/`): produce the property tree for the type. Plain string inputs produce the same trees that were render-verified upstream.
3. **Create and place**: create the child object (plus listbox children for a filterpane), place its cell on the sheet grid (`viz/layout.ts`), save.
4. **Gate** (`viz/validate.ts` `validateObject`): read back the saved properties and layout and check them: known type, master links, engine errors, expressions, shape, supernova default property blocks, pivot mode, empty cubes, filterpane children. The master-item list is read at most once per gate run. The installed-extension list it compares types against is cached for 5 minutes per host, so an extension installed in the last 5 minutes can still be reported as an unknown type until the cache expires.
5. **Placement** (`viz/layout.ts`): unplaced objects, orphan cells, off-grid cells, overlaps.

`validate_sheet` runs steps 4 and 5 on existing objects. The full list of checks is in [chart-building.md](chart-building.md#the-validation-gate).

The gate cannot see pixels. Rendering is verified separately, in a real browser, with `scripts/render_proof.mjs` (see [chart-building.md](chart-building.md#verifying-rendering-with-render_proofmjs)).

## Adding a chart type

Each chart type is one file in `src/viz/types/` that exports a `ChartType` (the contract is in `src/viz/types/contract.ts`), and one line in the ordered registry `src/viz/types/index.ts`. Everything else is derived from the registry: `VIZ_SPECS` (shape limits used by pre-flight, the gate and the tool descriptions), auto-placement tile sizes, option applicability, per-measure color support and the set of nebula.js types the gate checks for default property blocks. Registry order is the order in which tool descriptions list the types.

A `ChartType` has:

| Field | Meaning |
|---|---|
| `name` | The `visualization` value, as the Qlik client writes it. |
| `spec` | `minDims`, `maxDims`, `minMeasures`, `maxMeasures`; `cube` (`hypercube`, `listobject`, `filterpane` or `none`); `pivot: true` if the cube needs `qMode: "P"`; `renderVerified: false` until a render proof exists. |
| `minTile` | Optional. Smallest auto-placed tile the type draws in (default 8 × 4). |
| `nebula` | Optional. `true` if a nebula.js supernova draws it: it gets the shared default property blocks, and the gate checks for them. |
| `options` | Optional. The styling options the type honours. Any other option is reported in `notes` as ignored. |
| `measureColors` | Optional. `true` if per-measure colors apply. |
| `build(input)` | Returns the property tree. `input` has the normalized dimensions and measures, the options already filtered to this type, and the base properties. Shared helpers such as `buildCube` are in `src/viz/build.ts`. |

Steps:

1. **Learn the real property contract.** Author the chart in the Qlik client and harvest it: `node scripts/harvest_client_props.mjs <qType> out.json`. Do not reconstruct properties from error messages; some charts fail without any.
2. **Write `src/viz/types/<name>.ts`**, mirroring the harvested object, with `spec.renderVerified: false`. List only the options you have actually wired.
3. **Register it** with one line in `src/viz/types/index.ts`.
4. **Gate**: if the type has a failure mode the generic checks don't cover, add a check to `src/viz/validate.ts`.
5. **Tests** (see [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-chart-type)): unit cases for its shape limits and properties, and a row in the builder tool test that every type passes its own gate.
6. **Regenerate the tool reference** (`npm run docs:tools`), because the `add_sheet_object` description lists the supported types.
7. **Verify rendering** with `scripts/render_proof.mjs` on a live site and look at the screenshots. Only then remove `renderVerified: false`, and update [chart-building.md](chart-building.md#verification-status).

## Adding a tool

1. Put it in the module for its area under `src/tools/`, so it inherits that module's group.
2. Register it with a zod input schema (use `guid` from `core/schemas.ts` for app and task ids), a description that says what it returns and whether it mutates, and honest annotations (`READ` from `core/annotations.ts` for read-only tools).
3. If it changes anything, register it only inside the module's `cfg.allowMutations` branch, and set `destructiveHint` truthfully.
4. Page any list output with `core/paging.ts`, and pass anything that can carry credentials through `core/redact.ts`.
5. Keep network access in `clients/` and logic in `core/`, `qix/` or `viz/`, so it can be tested without a site.
6. Regenerate the tool reference with `npm run docs:tools`.
