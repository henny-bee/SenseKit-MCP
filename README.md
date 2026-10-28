# SenseKit-MCP

An MCP server for **Qlik Sense Enterprise on Windows** (client-managed, QSEoW).

It exposes the site's Repository (QRS), Engine (QIX) and Proxy APIs as [Model Context Protocol](https://modelcontextprotocol.io) tools. An AI agent can then query app data, trace where a number comes from, inspect reloads and security rules, and build sheets and charts whose rendering the server checks as far as it can.

SenseKit-MCP is a modification of [qseow-mcp](https://github.com/rmterenzi/qseow-mcp) by Terenzi LLC (see [Credits](#credits)) and is not sponsored by anyone. Terenzi LLC does not maintain or endorse this modified version, and it is not affiliated with, endorsed by, or sponsored by QlikTech International AB.

## Highlights

- **50 tools in three personas.** Analyst (query and trace), developer (scripts, reloads, apps, the sheet and chart builder, master items) and admin (inventory, tasks, reload forensics, engine health, security-rule audit, proxy sessions). You choose which groups to expose.
- **Read-only by default.** The 16 tools that change anything are not even registered until you set `QSEOW_ALLOW_MUTATIONS=true`.
- **Answers carry their context.** Value-returning analytics tools report the selections a number was computed under, and warn about unknown fields, which Qlik silently evaluates to 0 or null.
- **A builder that checks what it builds.** `add_sheet_object` refuses bad definitions before writing anything, then runs a validation gate on the saved object. That gate catches the definitions the engine accepts but the Qlik client draws blank. It supports 19 chart types plus navigation buttons, master-item links, number formats and styling options.
- **Credential redaction** on every path that returns QRS entities, scripts, logs or object properties.
- **Structured errors** (`{ code, message, details }`) that an agent can act on.
- **Certificate, JWT or Windows-login authentication**, including the CSWSH handshake a virtual proxy requires for the engine WebSocket. Windows mode needs no certificates and no Qlik admin: it signs in through the hub's login page as your own account.

## Quick start

You need Node.js 20 or later and access to a QSEoW site.

Pick an authentication mode first (full details in [docs/authentication.md](docs/authentication.md)):

- Certificate mode (the default) uses `client.pem`, `client_key.pem` and `root.pem` exported as PEM from **QMC → Certificates → Export**.
- Windows mode needs no certificates and no Qlik admin: it signs in through the hub's login page with your Windows account (`QSEOW_AUTH_MODE=windows`, `QSEOW_USERNAME=DOMAIN\user`, and `QSEOW_PASSWORD` or `QSEOW_PASSWORD_PATH`).
- JWT mode authenticates with a signed token against a JWT virtual proxy (`QSEOW_AUTH_MODE=jwt`, and `QSEOW_JWT` or `QSEOW_JWT_PATH`).

If you run from a local clone instead of `npx -y sensekit-mcp`, build once and create a `.env` file:

```bash
npm install          # installs dependencies and builds dist/index.js
cp .env.example .env # fill in QSEOW_HOST and your auth settings
```

MCP clients launch the server from their own working directory, so point `QSEOW_ENV_PATH` at the absolute path to your `.env` file (or pass the `QSEOW_*` variables directly in the client config).

### Claude Code

Using `npx` (published package):

```bash
claude mcp add sensekit --scope user \
  -e QSEOW_HOST=sense.example.com \
  -e QSEOW_CERT_PATH=/absolute/path/to/client.pem \
  -e QSEOW_CERT_KEY_PATH=/absolute/path/to/client_key.pem \
  -e QSEOW_ROOT_CERT_PATH=/absolute/path/to/root.pem \
  -- npx -y sensekit-mcp
```

Using a local clone and `.env`:

```bash
claude mcp add sensekit --scope user \
  -e QSEOW_ENV_PATH=/absolute/path/to/SenseKit-MCP/.env \
  -- node /absolute/path/to/SenseKit-MCP/dist/index.js
```

### Claude Desktop

Download `sensekit-mcp-<version>.mcpb` from [Releases](https://github.com/henny-bee/SenseKit-MCP/releases), or build it locally with `npm run bundle`, then open the `.mcpb` file. Claude Desktop prompts for the host, auth mode and certificate paths without editing JSON.

To configure `claude_desktop_config.json` manually instead, open **Settings → Developer → Edit Config** (`%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```jsonc
{
  "mcpServers": {
    "sensekit": {
      "command": "node",
      "args": ["/absolute/path/to/SenseKit-MCP/dist/index.js"],
      "env": {
        "QSEOW_ENV_PATH": "/absolute/path/to/SenseKit-MCP/.env"
      }
    }
  }
}
```

### Cursor

Add the server to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project), then enable it under **Cursor Settings → MCP**:

```jsonc
{
  "mcpServers": {
    "sensekit": {
      "command": "node",
      "args": ["/absolute/path/to/SenseKit-MCP/dist/index.js"],
      "env": {
        "QSEOW_ENV_PATH": "/absolute/path/to/SenseKit-MCP/.env"
      }
    }
  }
}
```

### OpenCode

Add via CLI (writes to `~/.config/opencode/opencode.json`):

```bash
opencode mcp add sensekit --global \
  --env QSEOW_ENV_PATH=/absolute/path/to/SenseKit-MCP/.env \
  -- node /absolute/path/to/SenseKit-MCP/dist/index.js
```

Or add it under `mcp.servers` in `~/.config/opencode/opencode.json` (or project `opencode.json`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "sensekit": {
        "type": "local",
        "command": [
          "node",
          "/absolute/path/to/SenseKit-MCP/dist/index.js"
        ],
        "cwd": "/absolute/path/to/SenseKit-MCP",
        "environment": {
          "QSEOW_ENV_PATH": "/absolute/path/to/SenseKit-MCP/.env"
        }
      }
    }
  }
}
```

### VS Code (GitHub Copilot), Windsurf & other MCP clients

For **VS Code** (`.vscode/mcp.json`, using `"servers"` instead of `"mcpServers"`):

```jsonc
{
  "servers": {
    "sensekit": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/SenseKit-MCP/dist/index.js"],
      "envFile": "/absolute/path/to/SenseKit-MCP/.env"
    }
  }
}
```

For **Windsurf** (`~/.codeium/windsurf/mcp_config.json`), **Cline**, or any standard `mcpServers` client with inline environment variables:

```jsonc
{
  "mcpServers": {
    "sensekit": {
      "command": "npx",
      "args": ["-y", "sensekit-mcp"],
      "env": {
        "QSEOW_HOST": "sense.example.com",
        "QSEOW_CERT_PATH": "/absolute/path/to/client.pem",
        "QSEOW_CERT_KEY_PATH": "/absolute/path/to/client_key.pem",
        "QSEOW_ROOT_CERT_PATH": "/absolute/path/to/root.pem"
      }
    }
  }
}
```

The server starts **read-only**. To allow write tools, add `QSEOW_ALLOW_MUTATIONS=true`, preferably against a test site first. On start it prints one line to stderr with the host, auth mode, enabled groups and mutation status.

All settings are described in [docs/configuration.md](docs/configuration.md).

## Safety model

| Control | What it does |
|---|---|
| Mutation gating | Tools that change anything (scripts, reloads, apps, tasks, sessions, sheets and objects, master items) are registered only when `QSEOW_ALLOW_MUTATIONS=true`. Otherwise they are missing from `tools/list`, not merely refused when called. |
| Tool groups | `QSEOW_TOOL_GROUPS` limits the server to the personas you need (`analyst`, `developer`, `admin`). |
| Annotations | Every tool declares MCP hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: false`) so clients can ask for confirmation where it matters. |
| Redaction | Passwords, secrets, API keys and tokens are masked in QRS entities, connection strings, load scripts, reload logs, object properties, builder responses and error messages. `set_script` refuses to write back a script that contains the redaction marker. |
| Input checks | App and task ids must be GUIDs. Builder definitions are checked against the data model and the engine before anything is written. |
| Guarded deletes | `delete_master_item` refuses while charts still link to the item. `update_sheet_object` refuses types it does not build. |
| Identity | Certificate, signed JWT or a Windows login only; header-authentication proxies are deliberately unsupported. In jwt and windows mode the agent is limited by the user's security rules and section access. |

Read [SECURITY.md](SECURITY.md) before deploying, and [docs/authentication.md](docs/authentication.md#trust-model) before using JWT in production.

## Tools

The complete reference, with every input and annotation, is [docs/tools.md](docs/tools.md). It is generated from the server's real `tools/list`.

**Analyst** (group `analyst`): ask questions and trace numbers.

| Tools | Purpose |
|---|---|
| `list_engine_apps`, `get_app_data_model` | Find apps; tables and fields |
| `evaluate_expression`, `create_hypercube`, `crosscheck_expression` | Evaluate expressions, group-by queries, and a total vs. sum-of-groups check for non-additive measures |
| `get_field_values`, `select_field_values`, `get_current_selections`, `clear_selections` | Field values and selection state |
| `list_sheets`, `get_sheet_objects`, `get_object_properties` | Walk sheets, objects and their definitions |
| `search_expressions` | Find a field or expression fragment across objects, master items, variables and the script |
| `list_master_measures`, `list_master_dimensions`, `evaluate_master_measure` | The governed definitions |
| `get_app_lineage` | Every LOAD and STORE source and target in the script |

**Developer** (group `developer`): build and ship.

| Tools | Purpose |
|---|---|
| `get_script`, `check_script`, `set_script`, `reload_app` | Read, check, replace and reload the load script |
| `create_app`, `copy_app`, `publish_app`, `delete_app` | App lifecycle |
| `create_sheet`, `add_sheet_object`, `update_sheet_object`, `move_sheet_object`, `delete_sheet_object` | Build and maintain sheets and charts |
| `validate_sheet` | The render-validation gate on an existing sheet or object (read-only) |
| `create_master_measure`, `create_master_dimension`, `delete_master_item` | Master-item governance |

**Admin** (group `admin`): govern and operate the site.

| Tools | Purpose |
|---|---|
| `qrs_about`, `service_status`, `license_summary` | Version, service health on every node, license allocation |
| `list_apps`, `list_streams`, `list_tasks`, `list_users`, `list_extensions`, `list_data_connections` | Paged, filterable inventory |
| `qrs_search` | Any QRS entity with a filter expression |
| `start_task`, `get_reload_log` | Run a reload task; why a reload failed |
| `engine_healthcheck`, `security_rule_audit` | Engine memory, CPU and sessions; security rules with decoded actions and lint findings |
| `list_user_sessions`, `end_user_sessions` | Proxy sessions per user; force logout (needs certificate files in either mode) |

With every group enabled and certificate files configured, read-only mode registers 34 tools, and allowing mutations adds 16 more. Without certificate files, the two proxy-session tools are absent.

## Building a chart

With mutations enabled:

```jsonc
// 1. create_sheet
{ "appId": "11111111-2222-3333-4444-555555555555", "title": "Sales overview" }

// 2. add_sheet_object
{
  "appId": "11111111-2222-3333-4444-555555555555",
  "sheetId": "<sheetId from step 1>",
  "visualization": "barchart",
  "title": "Revenue by region",
  "dimensions": [{ "field": "Region", "sort": "asc" }],
  "measures": [{ "expression": "Sum(Sales)", "label": "Revenue", "numberFormat": { "type": "money" } }],
  "options": { "orientation": "horizontal", "showDataLabels": true }
}
```

The response contains the new `objectId`, its grid `cell`, and `validation.status` (`pass`, `warn` or `fail`) with findings. It also has `notes` for any option that does not apply to the chart type. A misspelled dimension field is refused before anything is written (`NOT_FOUND`). A misspelled field in a measure is created, but the gate fails it, because Qlik would show `0` without an error. Finish with `validate_sheet` for a whole-sheet verdict.

Dimensions can be field names, calculated dimensions (`=...`) or master dimensions (`{ "libraryId": ... }`); measures can be expressions or master measures. Details, including number formats, options, the filterpane and every gate check, are in [docs/chart-building.md](docs/chart-building.md).

## Verification status

- **Render-verified upstream:** the 12 original chart types (kpi, gauge, barchart, linechart, combochart, piechart, scatterplot, treemap, table, pivot-table, listbox, text-image), built from plain string inputs. The upstream project opened them in a real browser at sheet-tile size on Qlik Sense May 2026. This fork keeps those definitions unchanged.
- **Not render-verified yet:**
  - styling options (colors and color modes, legend, data labels, sort by measure, horizontal and stacked bars);
  - per-measure colors and number formats;
  - master-item links (`libraryId`) in charts;
  - labels, sort and calculated dimensions in the object form;
  - the filterpane;
  - the action-button (navigation buttons);
  - the bullet chart, box plot, histogram, distribution plot, waterfall chart and Mekko chart.

  No live site was available while these were developed. The engine-side gate checks them, but nobody has looked at them in a browser.
- **How to verify:** build the objects on a test site, then run `scripts/render_proof.mjs` with Playwright and a JWT virtual proxy. It renders each object in a headless browser at two tile sizes, saves a screenshot per object, and exits non-zero unless everything rendered. The screenshots are the evidence; see [docs/chart-building.md](docs/chart-building.md#verifying-rendering-with-render_proofmjs).
- **Tests:** the automated tests run against in-memory fakes of the Engine and QRS, not against a live site. `npm run smoke` and the demos in [examples/](examples/) run against a real site.

## Documentation

The documents below live in the GitHub repository; the npm package contains only the server, this README, the license files and `.env.example`.

| Document | Contents |
|---|---|
| [docs/tools.md](docs/tools.md) | Every tool: description, inputs, annotations, gating |
| [docs/configuration.md](docs/configuration.md) | Every environment variable, defaults, `.env` loading, TLS trust |
| [docs/authentication.md](docs/authentication.md) | Certificate vs. JWT vs. Windows login, the CSWSH handshake, minting a test JWT, trust model, production patterns |
| [docs/chart-building.md](docs/chart-building.md) | Builder tools, input forms, the validation gate, verification status, the render proof |
| [docs/errors.md](docs/errors.md) | Structured error codes and what to do about each |
| [docs/architecture.md](docs/architecture.md) | Layers, dependency rules, request flow, adding a chart type or tool |
| [examples/](examples/README.md) | Three runnable demos against a live site: tracing a wrong number, site operations, building a sheet |
| [CHANGELOG.md](CHANGELOG.md) | Changes, including what differs from qseow-mcp 0.5.2 |

## Development

```bash
npm install            # installs and builds dist/
npm test               # build + all tests (no Qlik site needed)
npm run typecheck
cp .env.example .env   # fill in host and auth
node dist/index.js     # run the stdio server from source
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers the test layout, CI, the code rules, how to add a tool or chart type, and the render-proof requirement for new chart shapes.

## Credits

SenseKit-MCP is based on [qseow-mcp](https://github.com/rmterenzi/qseow-mcp) by Terenzi LLC, licensed under Apache-2.0. Its original QRS, Engine and Proxy tools, the render-validation approach, and the authentication research documented here come from that project. This fork has been substantially modified by H-Bee; see [CHANGELOG.md](CHANGELOG.md) and [NOTICE](NOTICE).

## License

Apache License 2.0. Copyright 2026 H-Bee. Portions copyright 2026 Terenzi LLC. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Trademarks

Qlik, Qlik Sense and related marks are trademarks of QlikTech International AB. They are used here only to identify the software this project works with. This project is not a Qlik product and is not affiliated with, endorsed by, or sponsored by QlikTech International AB.
