# Project structure

Where each part of the code lives, and where new code goes. How the parts work together at runtime is in [architecture.md](architecture.md).

```
sensekit-mcp/
├── .github/
│   └── workflows/
│       └── ci.yml                  # CI: build, tests and doc check on every push
├── docs/                           # Documentation
│   ├── architecture.md             # How the parts work together at runtime
│   ├── authentication.md           # Certificate, JWT and Windows login
│   ├── chart-building.md           # The sheet and chart builder
│   ├── configuration.md            # Every environment variable
│   ├── errors.md                   # Error codes and what to do about them
│   ├── structure.md                # This file
│   └── tools.md                    # Every tool (generated: npm run docs:tools)
├── examples/                       # Runnable demos against a live site
│   ├── builder-demo/               # Building a sheet
│   ├── finance-close-demo/         # Tracing a wrong number
│   └── ops-demo/                   # Site operations
├── mcpb/                           # Claude Desktop bundle (npm run bundle)
│   ├── build.mjs
│   └── manifest.template.json
├── scripts/                        # Developer scripts
│   ├── run-tests.mjs               # Test runner behind npm test
│   ├── gen-tools-doc.mjs           # Writes and checks docs/tools.md
│   ├── smoke.mjs                   # End-to-end check on a live site (npm run smoke)
│   ├── harvest_client_props.mjs    # Saves a client-made chart's properties, the reference for a new chart type
│   ├── viz_matrix.mjs              # Builds a test sheet with every chart type on a live site
│   ├── fixture_sheet.mjs           # Builds a fixture sheet on a live site
│   └── render_proof.mjs            # Renders objects through a JWT proxy (render_sheet is simpler)
├── src/                            # The server, in TypeScript (compiled to dist/)
│   ├── index.ts                    # Start: read the config, create the clients, serve over stdio
│   ├── config.ts                   # Every environment variable, read into one typed Config
│   ├── server.ts                   # Creates the MCP server and registers the tools
│   ├── clients/                    # Network: the only code that talks to Qlik
│   │   ├── engine.ts               # Engine WebSockets, one per app
│   │   ├── qrs.ts                  # QRS REST API
│   │   ├── qrs-types.ts            # QRS entity types
│   │   ├── proxy-session.ts        # Windows/JWT login and the session cookie
│   │   ├── raw-https.ts            # Engine health check and Proxy Service API
│   │   └── browser.ts              # Headless browser for render_sheet
│   ├── core/                       # Small helpers with no Qlik connection
│   │   ├── errors.ts               # Error codes and ToolError
│   │   ├── result.ts               # Tool result format
│   │   ├── schemas.ts              # Shared input schemas (GUID)
│   │   ├── annotations.ts          # Tool hints (read-only, destructive)
│   │   ├── redact.ts               # Hides secrets in output
│   │   ├── paging.ts               # offset/limit for long lists
│   │   ├── cache.ts                # Short-lived cache
│   │   ├── pool.ts                 # Limits parallel engine calls
│   │   ├── lock.ts                 # One write per app at a time
│   │   ├── qrs-filter.ts           # Quotes values in QRS filters
│   │   ├── qrs-status.ts           # Task and reload status names
│   │   ├── security-rules.ts       # Decodes security-rule actions
│   │   ├── health.ts               # Flattens the engine health check
│   │   ├── lineage.ts              # Classifies data lineage
│   │   ├── logs.ts                 # Tails of reload logs
│   │   └── walk.ts                 # Visits every string in a JSON tree
│   ├── qix/                        # Engine (QIX) helpers that work for any object
│   │   ├── types.ts                # Typed engine interfaces
│   │   ├── objects.ts              # Sheets, objects, property trees
│   │   ├── quality.ts              # Expression and field checks
│   │   ├── selection.ts            # Selection values
│   │   └── save.ts                 # Saving the app
│   ├── viz/                        # The chart builder
│   │   ├── types/                  # Chart types
│   │   │   ├── index.ts            # The registry: one line per chart type
│   │   │   ├── contract.ts         # What a chart type must provide
│   │   │   └── <visualization>.ts  # One file per type: kpi.ts, barchart.ts, bulletchart.ts, ...
│   │   ├── build.ts                # Shared building blocks
│   │   ├── inputs.ts               # Checks dimension and measure inputs
│   │   ├── options.ts              # Styling options
│   │   ├── number-format.ts        # Number formats
│   │   ├── schemas.ts              # Builder input schemas
│   │   ├── props.ts                # Picks the chart type's builder
│   │   ├── specs.ts                # Shape limits (how many dimensions and measures)
│   │   ├── definition.ts           # Pre-flight checks, then create
│   │   ├── validate.ts             # The validation gate
│   │   ├── layout.ts               # Sheet grid and placement
│   │   └── read-back.ts            # Turns an existing object back into inputs (for updates)
│   └── tools/                      # The MCP tools, one file per area
│       ├── index.ts                # Decides which tool groups load
│       ├── error-boundary.ts       # Turns every error into a structured tool error
│       ├── admin.ts                # admin: site inventory, apps, users, tasks
│       ├── ops.ts                  # admin: reload logs, health, security rules, sessions
│       ├── analyst.ts              # analyst: data model, expressions, selections
│       ├── inspector.ts            # analyst: sheets, objects, master items, lineage
│       ├── developer.ts            # developer: load script, reload, app lifecycle
│       ├── builder.ts              # developer: sheets and charts
│       ├── master.ts               # developer: master measures and dimensions
│       └── render.ts               # developer: render_sheet
├── tests/                          # Automated tests (npm test), no Qlik site needed
│   ├── unit/                       # One file per source file: <folder>.<file>.test.mjs
│   ├── tools/                      # Whole tools through a real MCP client: tools.<module>.test.mjs
│   ├── helpers/                    # Fake engine, fake QRS, test harness, tool inventory
│   └── fixtures/                   # Property trees captured from a real site
├── .env.example                    # Settings template: copy to .env
├── .gitignore
├── CHANGELOG.md                    # What changed in each version
├── CONTRIBUTING.md                 # How to develop and test
├── LICENSE                         # Apache-2.0
├── NOTICE                          # Attribution to qseow-mcp
├── README.md                       # Start here
├── SECURITY.md                     # Reporting a security issue
├── package.json                    # Dependencies and npm scripts
├── package-lock.json
├── server.json                     # MCP Registry entry, with every environment variable
└── tsconfig.json                   # TypeScript settings
```

Not in git: `dist/` (build output), `node_modules/`, `coverage/` and your `.env`.

Imports only point down the layers, never up: `tools/` → `viz/` → `qix/` → `core/`. Only `clients/` talks to the network. `npm test` enforces this; the exact rules are in [architecture.md](architecture.md#dependency-rules).

## Where new things go

| To add | Put it in | Also update |
|---|---|---|
| A tool | the `src/tools/<area>.ts` of its group; a new area is a new file plus one line in `tools/index.ts` | `tests/helpers/inventory.mjs`, then `npm run docs:tools` |
| A chart type | `src/viz/types/<visualization>.ts` plus one line in `types/index.ts` | tests and `npm run docs:tools`; steps in [architecture.md](architecture.md#adding-a-chart-type) |
| A call to a Qlik API | `src/clients/` | |
| An engine helper | `src/qix/` | |
| A helper with no Qlik connection | `src/core/` | |
| An environment variable | `src/config.ts` | `.env.example`, [configuration.md](configuration.md), `server.json` |
| A test | `tests/unit/<folder>.<file>.test.mjs` or `tests/tools/tools.<module>.test.mjs` | |
| A document | `docs/` | this tree, and the Documentation table in the README |

File names are lowercase with hyphens. A chart type's file is named after its `visualization` value, such as `pivot-table.ts` or `bulletchart.ts`.
