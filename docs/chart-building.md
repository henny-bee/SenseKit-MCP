# Building sheets and charts

The developer group includes a sheet and chart builder. It creates sheets and visualization objects through the Engine (QIX), and checks each object with a **render-validation gate**. The gate exists because the engine accepts and saves many definitions that the Qlik Sense client then draws as a blank tile or an error box. "Saved" and "renders" are different claims; the builder tries to prove the second.

All tools on this page except `validate_sheet` are mutation-gated: they exist only when `QSEOW_ALLOW_MUTATIONS=true`. Exact input schemas are in [tools.md](tools.md).

> **Verification status, in short.** The 12 original chart types, built from plain string inputs, were render-verified in a real browser by the upstream project on Qlik Sense May 2026. Of what this fork added, the filterpane, the button, all six newer chart types, combo chart series, KPI color bands, colors and master-item links have been seen in a browser with `render_sheet`; number formats, calculated dimensions, pivot column dimensions and the other styling options are **not yet render-verified**. See [Verification status](#verification-status) and [how to verify](#verifying-rendering-with-render_proofmjs).

## The tools

| Tool | What it does |
|---|---|
| `create_sheet` | Creates an empty sheet (default grid 24 columns × 12 rows) and returns its `sheetId`. |
| `add_sheet_object` | Pre-flight checks the definition, creates the object on the sheet, places it on the grid, saves, then runs the gate on it. The response includes `objectId`, `cell`, `validation` and `placementFindings`, plus `notes` when inputs were ignored. |
| `update_sheet_object` | Rebuilds an existing builder-supported object in place (same id, same type) and runs the gate again. |
| `move_sheet_object` | Moves or resizes an object's cell, or places an object that has no cell, then runs placement checks. |
| `delete_sheet_object` | Deletes an object and its children (for example a filterpane's listboxes) and removes its cell. |
| `validate_sheet` | Read-only. Runs the gate on one object (`objectId`) or on every object of a sheet plus placement checks (`sheetId`). |
| `render_sheet` | Read-only. Opens the sheet in a headless browser and returns a screenshot plus each object's status. Windows or jwt auth only; see [Seeing a sheet with `render_sheet`](#seeing-a-sheet-with-render_sheet). |
| `create_master_measure`, `create_master_dimension`, `delete_master_item` | Manage the app's master (library) items that charts can link to. |

Useful read-only companions: `get_app_data_model` (field names), `list_sheets`, `get_sheet_objects`, `get_object_properties`, `list_master_measures`, `list_master_dimensions`.

## Supported visualization types

| Type | Dimensions | Measures | Notes |
|---|---|---|---|
| `kpi` | 0 | 1–2 | |
| `gauge` | 0 | 1 | Property set mirrored from a gauge authored in the Qlik client. |
| `barchart` | 1–2 | 1–9 | Supports `orientation` and `stacked`. |
| `linechart` | 1–2 | 1–9 | |
| `combochart` | 1 | 1–9 | Each measure can be a bar, line or marker on the primary or secondary axis (`series`). |
| `piechart` | 1 | 1 | |
| `scatterplot` | 1 | 2–3 | |
| `treemap` | 1–9 | 1 | Uses tree-mode cube (`qMode: "K"`). Needs a large tile. |
| `bulletchart` | 0–1 | 1–15 | One measure with a dimension, up to 15 without. Each measure can have a `target`. With a dimension all rows share one axis, so they compare on one scale; separate measures keep their own axes. |
| `boxplot` | 1–2 | 1 | `dimensions[0]` is what each point is (for example Customer), the optional `dimensions[1]` gives one box per value (for example Year). The cube is stored under `boxplotDef`. |
| `histogram` | 1 | 0 | One numeric field or calculated dimension; the client bins and counts the values (10 bins, automatic). |
| `distributionplot` | 1–2 | 1 | Like the box plot: points per `dimensions[0]`, one row per value of `dimensions[1]`. Tree-mode cube. |
| `waterfallchart` | 0 | 1–50 | Each measure is a step; see `operation` and `subtotal`. |
| `mekkochart` | 2 | 1 | Columns by `dimensions[0]`, cells by `dimensions[1]`, sized by the measure. Cell colors are the client's automatic per-value colors; they cannot be set yet. |
| `table` | 0–99 | 0–99 | |
| `pivot-table` | 1–99 | 1–99 | Uses pivot cube (`qMode: "P"`). Dimensions are rows unless marked `pivotColumn`. |
| `listbox` | 1 | 0 | |
| `text-image` | 0 | 0 | Shows the `title` text as its content. It takes no measures; use a `kpi` for a live value. |
| `filterpane` | 1–20 | 0 | A container with one listbox child per dimension. |
| `action-button` | 0 | 0 | The client's **Button**. `title` is its label, `options.color` its background, `options.navigateTo` where a click goes. Auto-placed as 4 × 2. |

A shape outside these ranges is refused before anything is written. Any other `visualization` string is not refused, but the gate fails the object unless it matches a known Qlik built-in or an extension installed on the site.

## A minimal example

1. Find the fields: `get_app_data_model { appId }`.
2. Create a sheet: `create_sheet { appId, title: "Sales overview" }` returns `sheetId`.
3. Add charts:

   ```json
   {
     "appId": "11111111-2222-3333-4444-555555555555",
     "sheetId": "<sheetId>",
     "visualization": "barchart",
     "title": "Sales by region",
     "dimensions": ["Region"],
     "measures": ["Sum(Sales)"]
   }
   ```

4. Read `validation.status` in the response: `pass`, `warn` or `fail`, with `findings` that say why.
5. Check the whole sheet at the end: `validate_sheet { appId, sheetId }` returns a `verdict` of `PASS`, `WARN` or `FAIL`.

## Input forms

### Dimensions

Each entry in `dimensions` is either a string or an object.

| Form | Example | Meaning |
|---|---|---|
| String | `"Region"` | A field name. |
| String starting with `=` | `"=Year(OrderDate)"` | A calculated dimension. |
| `{ field }` | `{ "field": "Region", "label": "Sales region", "sort": "desc" }` | A field, with optional label and sort. A `field` must not start with `=`; use `expression` instead. |
| `{ expression }` | `{ "expression": "=Year(OrderDate)", "label": "Year" }` | A calculated dimension. The leading `=` is added if missing. |
| `{ libraryId }` | `{ "libraryId": "<master dimension id>" }` | A link to a master dimension. |

An object needs **exactly one** of `field`, `expression` or `libraryId`. `sort` is one of `asc`, `desc` or `loadOrder`. A `label` on a master-dimension link is ignored (the master item's own label is shown) and reported in `notes`.

Two more keys work in any of the object forms:

| Key | Example | Meaning |
|---|---|---|
| `includeNulls` | `{ "field": "Salesrep", "includeNulls": false }` | `false` hides the dimension's null row, the `-` entry with value 0. This is the client's **Include null values** checkbox (`qNullSuppression`). The default (`true`, or leaving it out) shows it, as the client does. Applies to every type with a hypercube; on a listbox or filterpane it is ignored and reported in `notes`. |
| `pivotColumn` | `{ "field": "Year", "pivotColumn": true }` | `pivot-table` only: the dimension goes across the top instead of down the side. Column dimensions must come **after** all row dimensions, and at least one row dimension must remain; otherwise the request is refused with `INVALID_INPUT`. On any other type it is ignored and reported in `notes`. |

Where a null row comes from: a calculated dimension that returns null for some records puts all of them in one `-` row, for example the products outside the top 10 in `=Aggr(If(Rank(Sum(Sales)) <= 10, Product), Product)`. Fact records whose key has no match in the dimension's table do the same. Dimension values with no data at all, such as sales reps without orders, are not null rows but zero rows; hide those with `options.includeZeros: false`.

### Measures

| Form | Example | Meaning |
|---|---|---|
| String | `"Sum(Sales)"` | An expression. |
| `{ expression }` | `{ "expression": "Sum(Sales)", "label": "Revenue", "numberFormat": { "type": "money" }, "color": "#1f77b4" }` | An expression with optional label, number format and color. |
| `{ libraryId }` | `{ "libraryId": "<master measure id>", "numberFormat": { "type": "percent" } }` | A link to a master measure. A number format here is a per-chart override; a label is ignored and reported in `notes`. |

An object needs **exactly one** of `expression` or `libraryId`. `color` is a hex color (`#rgb` or `#rrggbb`) and applies only to `barchart`, `linechart` and `combochart`. It is ignored when `options.colorMode` is also set.

`target` applies only to `bulletchart`: an expression for the target marker, for example `"Sum(Budget)"`.

`operation` and `subtotal` apply only to `waterfallchart`. `operation` is `add` (the default), `subtract` or `subtotal`; a `subtotal` step shows the running total so far, and its expression is not used. `subtotal` is a label: it adds a subtotal bar with that label after the measure. A typical profit bridge is `["Sum(Sales)", { "expression": "Sum(Cost)", "operation": "subtract", "subtotal": "Gross margin" }, { "expression": "Sum(Freight)", "operation": "subtract" }]`.

`colorBands` applies only to `kpi` and colors the value by thresholds: `{ limits, colors }`, where `limits` are numbers in ascending order and `colors` holds one more hex color than `limits`, lowest band first. `colors[i]` is used below `limits[i]`, the last color from the top limit up. `{ "limits": [0], "colors": ["#c0392b", "#2e7d32"] }` shows a year-over-year change red below 0 and green from 0; `{ "limits": [], "colors": ["#1f3a5f"] }` is one fixed color. It works on the first and the second (comparison) measure and on master measures. The properties mirror client-authored KPIs and gauges (`qDef.conditionalColoring`); limits are numbers only, not expressions.

`series` applies only to `combochart` and is `{ type?, axis? }`: `type` is `bar` (default), `line` or `marker`, and `axis` is `primary` (default) or `secondary`. Use the secondary axis for a measure on a different scale, such as a margin % next to sales amounts; on one shared axis it would draw as a flat line at the bottom. Once any measure has a `series`, every measure of the chart gets one (the defaults where you gave none), and a chart with a secondary-axis measure gets a second measure axis on the far side. On other types `series` is ignored and reported in `notes`.

The combo chart stores measure colors and series the way the Qlik client does for a combo chart (`qDef.color` and `qDef.series`, mirrored from a client-authored combo chart), not the `qDef.coloring` that bar and line charts use.

### Number formats

`numberFormat` is `{ type, pattern?, decimals? }`. Without a pattern, the server builds one:

| `type` | Default pattern | Notes |
|---|---|---|
| `auto` | (none) | Keeps the format from the data model. |
| `number` | `#,##0.00` (decimals default 2) | |
| `integer` | `#,##0` | |
| `percent` | `0.0%` (decimals default 1) | |
| `money` | `$#,##0.00;-$#,##0.00` (decimals default 2) | |
| `date` | `YYYY-MM-DD` | |
| `custom` | (required) | `pattern` is required, for example `"#,##0.0 'units'"`. |

`decimals` is an integer from 0 to 15 and is used only when you give no pattern. The decimal and thousands separators are always written as `.` and `,`, so a pattern reads the same regardless of the app's locale settings. `create_master_measure` takes the same `numberFormat` object.

### Options

`options` sets chart-level styling. An option that does not apply to the chosen type is dropped, and the response lists it in `notes`. Nothing is dropped silently.

| Option | Values | Applies to |
|---|---|---|
| `colorMode` | `auto`, `single`, `byDimension`, `byMeasure` | barchart, linechart, combochart, piechart, scatterplot, treemap. Only `auto` and `single` on bulletchart (bar color), boxplot (boxes and outlier points), histogram (bar color), waterfallchart (the positive bars; negative stays red, subtotals gray) and action-button (background). |
| `color` | hex color | Used with `colorMode: "single"`. Given alone, it implies `single` (and says so in `notes`). |
| `showLegend` | boolean | barchart, linechart, combochart, piechart, scatterplot, treemap, waterfallchart |
| `showDataLabels` | boolean | barchart, linechart, combochart, piechart, treemap, histogram, waterfallchart |
| `orientation` | `vertical`, `horizontal` | barchart, bulletchart, boxplot, distributionplot |
| `stacked` | boolean | barchart |
| `sortByMeasure` | `asc`, `desc` | barchart, combochart, piechart, table, bulletchart. Sorts by the first measure. |
| `includeZeros` | boolean | barchart, linechart, combochart, piechart, scatterplot, treemap, table, pivot-table, bulletchart, boxplot, distributionplot. `false` hides rows whose measures are all zero, like unticking **Include zero values** (`qSuppressZero`). The default shows them. |
| `navigateTo` | `{ action, sheetId?, url?, sameWindow? }` | action-button. See [Buttons](#buttons). |

`colorMode: "single"` without a `color` is refused.

### Position

`position` is `{ col, row, colspan, rowspan }` on the sheet grid. If you leave it out (in `add_sheet_object`, or in `move_sheet_object` for an object that has no cell), the object is auto-placed in an 8-column-wide tile, three tiles per row. Tiles are 8 × 4 by default; types that do not draw in a small tile get more height: piechart and scatterplot 8 × 6, treemap 8 × 8.

The tile goes into the usual slot for its position in the sequence, so a sheet of plain 8 × 4 tiles is laid out in a regular grid. If that slot would overlap an earlier, taller tile, the tile goes into the first free slot aligned to 8 columns, scanning rows from the top, or below the lowest tile if nothing fits. Auto-placed tiles never overlap. If a cell would extend past the grid, the grid grows instead of leaving the object off-sheet.

An explicit `position` is used exactly as given. If it overlaps another cell, that is reported as a warning in `placementFindings`.

## Master items in charts

1. `create_master_measure { appId, title, expression, label?, numberFormat? }`. The expression is checked first, and it is refused on any error **or unknown field**. That is stricter than the chart builder, because every chart that links to it inherits the definition. Duplicate titles are refused.
2. `create_master_dimension { appId, title, fields }`. One field makes a single dimension; several make a drill-down group (top level first). Plain fields must exist in the data model; `=...` entries are checked as expressions.
3. Link them into a chart with `{ "libraryId": "<id>" }` in `dimensions` or `measures`. Unknown ids are refused before the chart is created.
4. `delete_master_item { appId, kind, id }` first finds every object that links to the item and refuses while any exist, because those charts would show an error tile. Pass `force: true` to delete anyway; the response lists the broken references.

## Filterpane

`{ "visualization": "filterpane", "dimensions": ["Region", "Product"] }` creates a filterpane object and one listbox child per dimension. Each child uses the same property shape as a standalone `listbox`, which was render-verified, but the parent and child assembly has not been verified in a browser. The gate checks each child (field errors, broken master links), shows their findings on the pane, and always adds a warning that the filterpane is not render-verified.

## Buttons

`action-button` is the client's **Button** object. The builder uses it for navigation:

```json
{
  "visualization": "action-button",
  "title": "Sales overview",
  "options": { "color": "#1f3a5f", "navigateTo": { "action": "goToSheet", "sheetId": "<sheet id>" } }
}
```

| `navigateTo.action` | Needs | Goes to |
|---|---|---|
| `goToSheet` | `sheetId` (from `list_sheets`) | that sheet |
| `nextSheet`, `prevSheet` | | the next or previous sheet |
| `firstSheet`, `lastSheet` | | the first or last visible sheet |
| `openWebsite` | `url` (`http://`, `https://` or `mailto:`), optional `sameWindow` | a website or an e-mail, in a new tab unless `sameWindow` is true |
| `none` | | nowhere (removes the navigation) |

- `title` is the label on the button. The object title is set to the same text, so lists and the gate can name the button, but it is not drawn above it.
- `options.color` is the background. The label is white and bold, as in a button the client creates, so pick a dark color. Without a color the button uses the theme's default. `colorMode` `byDimension` and `byMeasure` do not apply.
- A `goToSheet` target that is not a sheet of the app is refused before anything is written (`NOT_FOUND`). The gate fails a button whose target sheet no longer exists, so `validate_sheet` finds buttons left pointing at a deleted sheet.
- The property set mirrors the button supernova's own defaults (`qlik-oss/sn-action-button`, `object-properties.js`), so an MCP-built button starts out like one dragged onto a sheet in the client. It has not been checked in a browser.
- Button actions (selections, bookmarks, variables, reloads) are not built. A button's actions set in the client are kept when the builder updates it.

## Updating, moving and deleting

`update_sheet_object` rebuilds the object's properties from scratch:

- `title`, `dimensions` and `measures` that you leave out are carried over from the current object, including labels, number formats and master links.
- `options` are **not** merged. Pass the complete styling you want; anything you leave out goes back to the default.
- Only the builder's own types can be updated. Extensions, maps, containers and other types are refused, because rebuilding them would discard properties the builder does not know.
- A filterpane's listbox children are deleted and recreated.
- An action-button keeps its navigation unless you pass `options.navigateTo`, and always keeps the actions set in the client. Without a new `title` it keeps its label.

`move_sheet_object` and `delete_sheet_object` check first that the object is a child of the given sheet.

`update_sheet_object` carries `includeNulls` and `pivotColumn` over with the dimensions, and `series` and colors with the measures, when you leave those out. `includeZeros` is an option, so like every option it reverts to the default unless you pass it again.

## Concurrent calls and saving

Write calls on the same app run **one at a time**, in the order they arrive; calls on different apps still run in parallel. Without this, parallel calls broke in two ways on a live site: two `add_sheet_object` calls on one sheet both read the sheet's cell list and wrote it back, so one object lost its cell; and their saves collided, so the engine answered `Write Failed`. This covers every builder and master-item tool, `set_script` and `reload_app`. It works within one server process; separate processes writing to the same app are not coordinated.

Every save is retried up to three times (after 0.25, 0.75 and 1.5 seconds) when the engine answers `Write Failed` (engine error 9000), and only then. If it still fails, the call returns `ENGINE_ERROR` with `details.attempts`. The change then exists in the engine session but is **not saved**, and it disappears when the session closes. Check the app's current state (for example with `get_sheet_objects`) before you retry, so the retry does not create a duplicate object.

## The validation gate

### Refused before anything is written

`add_sheet_object` and `update_sheet_object` refuse a request, without touching the app, when:

- an input breaks the rules above (for example not exactly one of `field`/`expression`/`libraryId`, an empty expression, a bad color, a bad number format, or `colorMode: "single"` without a color);
- the number of dimensions or measures is outside the type's range;
- a dimension field is not in the data model;
- a calculated dimension has any finding from the engine's expression check;
- a measure expression has a syntax error;
- a master-item id does not exist in the app.

A measure that names an unknown field is **not** refused. Qlik saves it and shows `0` without an error, so the builder creates it and the gate then fails it. That way the response says exactly what is wrong.

### Checked after creation, and by `validate_sheet`

| Finding | Severity |
|---|---|
| Visualization type is neither a known built-in nor an installed extension | fail |
| Type is not render-verified (currently: filterpane, action-button, bulletchart, boxplot, histogram, distributionplot, waterfallchart, mekkochart) | warn |
| Button goes to a sheet that does not exist in the app | fail |
| Button set to go to a sheet without a target sheet | warn |
| Link to a master item that does not exist in the app | fail |
| Engine error on a dimension or measure | fail |
| Unknown field or error in an inline measure expression or calculated dimension | fail |
| Shape (number of dimensions and measures) outside the type's range | fail |
| Chart drawn by a nebula.js supernova is missing a default property block (`color`, `legend`, `dataPoint`, `gridLine`, `tooltip`) | fail |
| Measures without a `cId` on a supernova chart | warn |
| Pivot table without `qMode` `P` or `K` | fail |
| Cube computes but returns 0 rows under the current selections | warn |
| Listbox field error | fail |
| Filterpane without listbox children | fail |
| Object cannot be read | fail |

For a whole sheet, `validate_sheet` also checks placement:

| Finding | Severity |
|---|---|
| Object has no cell, so it will not appear | fail |
| Cell extends past the grid | fail |
| Cell with a span of zero or less | fail |
| Cell that points to an object that is not on the sheet (orphan cell) | warn |
| Two cells overlap | warn |

The sheet `verdict` is `FAIL` if any finding is a fail, `WARN` if there are placement findings or any object warns, and `PASS` otherwise.

The list of installed extensions is cached for 5 minutes per host, so an extension installed within the last 5 minutes can be reported as an unknown type until the cache expires.

The gate inspects properties and engine results. It cannot see pixels. In particular, it does not warn that styling options, number formats or master links are unverified, so check those visually.

## Verification status

**Render-verified upstream.** The upstream project (qseow-mcp) built one object of each of the 12 original types with plain string inputs (field names and expressions), opened each in a headless browser at sheet-tile size, and checked it on Qlik Sense May 2026: kpi, gauge, barchart, linechart, combochart, piechart, scatterplot, treemap, table, pivot-table, listbox, text-image. This fork keeps the definitions built from plain strings unchanged.

**Seen in a browser by this fork.** On a live site (Qlik Sense Enterprise build 31.56.2, 2026-10), builder-made objects were opened with `render_sheet` and the screenshots checked by eye:

- the filterpane;
- the action-button: label and custom background color (whether a click navigates was not tested);
- the bullet chart: custom bar color, target marker, master measure, `includeZeros: false`, `sortByMeasure`, one shared axis per dimension;
- the histogram and the distribution plot;
- the box plot with a single color, the waterfall chart (`subtract`, a subtotal bar, positive bars in a single color, data labels) and the Mekko chart;
- combo chart `series` with a second measure axis, and per-measure colors on the combo chart;
- KPI `colorBands`, on an inline and on a master comparison measure;
- master-item links (`libraryId`) in bullet, waterfall and combo charts;
- dimension labels and `includeNulls: false` in the object form.

Two property errors were found and fixed this way: the bullet chart's bar color (the client reads `color.paletteColor`, not the documented `color.bar`) and the waterfall chart's custom colors (ignored while `color.auto` is true).

**Not render-verified yet:**

- styling `options` not used above: `byDimension` and `byMeasure` color modes, legend and data labels on bar and line charts, horizontal orientation and stacked bars;
- number formats (`numberFormat`), on chart measures and on master measures;
- calculated dimensions and dimension `sort`;
- pivot column dimensions (`pivotColumn`).

The engine-side gate checks these as far as it can. Whether they paint correctly is open until someone looks at them with `render_sheet` or the render proof below.

**Not supported yet.** Dimension limits ("show only the top 10, the rest as Others", `qOtherTotalSpec`) cannot be set. A calculated dimension such as `=Aggr(If(Rank(Sum(Sales)) <= 10, Product), Product)` gives a top 10, and `includeNulls: false` hides the null row it leaves for the other products.

## Seeing a sheet with `render_sheet`

`render_sheet` is the quickest way to check a sheet after building it. It opens `/sense/app/<appId>/sheet/<sheetId>/state/analysis` in a headless browser with the server's own proxy session cookie, so it needs no extra login and opens no extra proxy session. It returns a 1600 × 900 (16:9) screenshot and a status per object:

| Status | Meaning |
|---|---|
| `renders` | The cell shows something besides its title: a shape, an inked canvas, an image or text. |
| `blank` | The client finished the cell (`data-render-state="1"`) but nothing is drawn. Typical for an extension that does not accept the data. |
| `error` | The client shows an error state, such as "Incomplete visualization" or "This chart cannot be displayed" (English and German), or "Package License Expired". `message` has the text. |
| `not-rendered` | The cell was still loading after 20 seconds. |
| `missing` | The object has no grid cell on the sheet. |

The statuses are hints; the screenshot is the evidence. `objectId` gives a close-up of one object. The view shows the session's current selections, because the browser shares the engine session with the MCP server; call `clear_selections` first for an unfiltered view.

Setup: the tool is registered only in `windows` or `jwt` auth mode and when the optional dependency `playwright-core` is installed (`npm install` installs it, and the Claude Desktop bundle includes it). It downloads no browser: it starts the installed Microsoft Edge on Windows and Chrome elsewhere, or what `QSEOW_BROWSER` names (a channel such as `chrome`, or a path to the browser executable). The browser trusts the operating system's certificate store, not `QSEOW_ROOT_CERT_PATH`.

## Verifying rendering with `render_proof.mjs`

For a site with a JWT virtual proxy, or a run outside the MCP server, `scripts/render_proof.mjs` opens each object in a real headless browser through the Qlik client and reports whether it drew. Engine checks prove that a definition resolves and computes; only a browser shows whether the nebula.js chart actually paints.

### Setup

- Install Playwright yourself (it is deliberately not a dependency): `npm i -D playwright && npx playwright install chromium`.
- It needs a **JWT virtual proxy** and a token file, even if the server itself runs in certificate mode: it fetches `/{prefix}/qps/csrftoken` with the token and puts the returned session cookie in the browser.
- Environment: `QSEOW_HOST`, `QSEOW_PROXY_PORT` (default 443), `QSEOW_VP_PREFIX` (default `jwt`), `JWT_PATH` (file containing the token), and optionally `QSEOW_TLS_VERIFY=false` for a lab site with self-signed certificates, plus `SHOTS=<existing directory>` for screenshots.

### Run

1. Build the objects you want to check, for example with `node scripts/viz_matrix.mjs` (needs `QSEOW_ALLOW_MUTATIONS=true`). It creates an app called "MCP Viz Matrix" with one object of each original type built from plain inputs, runs the gate on each, tests four refusal paths, and leaves the app on the site. For new options or input forms, build your own test objects with `add_sheet_object`.
2. Collect the object ids with `get_sheet_objects` and write an inventory file:

   ```json
   { "appId": "<app id>", "objects": [ { "id": "<objectId>", "viz": "barchart", "title": "stacked, horizontal" } ] }
   ```

3. Run:

   ```bash
   mkdir -p shots
   SHOTS=./shots JWT_PATH=./token.jwt node scripts/render_proof.mjs inventory.json
   ```

For each object, at two sizes (`8x4-tile` 640 × 300 and `small` 340 × 180), it loads the object in the Qlik single-object view and prints a line with the type, the object id and one of these verdicts:

- `BROKEN(Qlik error state)` or `BROKEN(error element present)`: Qlik showed an error such as "This chart cannot be displayed", "Invalid visualization" or "Incomplete visualization";
- `renders`: something was painted (SVG shapes, canvas, table cells, KPI value) or digits appeared;
- `no-paint(check visually)`: nothing detectable was drawn;
- `LOAD-FAIL`: the page did not load in time.

### Read the screenshots

The printed verdicts are **advisory**. The screenshots are the evidence. Qlik draws some error states as SVG text inside a shadow root, and the upstream project saw automated checks report a treemap as rendered while it showed "This chart cannot be displayed." Look at every image.

Screenshots are named `<size>-<NN>-<viz>-<objectId>.png`, for example `8x4-tile-02-treemap-abc123.png`, where `NN` is the object's 1-based position in the inventory (two digits) and the type and id are reduced to letters, digits, `_` and `-`. Every object and size gets its own file.

The run ends with an `x/y renders` line that lists every object and size not proven to render. The exit code is 0 only if every object rendered at every size. It is 1 if any verdict is `BROKEN(...)`, `LOAD-FAIL` or `no-paint(check visually)`, and also when the token bootstrap fails or returns no session cookie. A 0 exit narrows what you must look at; it does not replace looking at the screenshots.

### Lessons from upstream

- Test at **sheet-tile size**, not full screen. A chart that draws at 900 × 620 can refuse in a small tile.
- **Counting painted shapes is not proof.** A broken chart still draws its legend.
- When a chart refuses to draw, don't guess properties from error messages; some charts fail without any. Author one in the Qlik client and copy what it writes: `node scripts/harvest_client_props.mjs <qType> [outFile]` scans every app the identity can open for client-authored objects of that type and dumps their properties. Qlik's own monitoring apps are a good source. This is how upstream fixed treemap (it needed `qMode: "K"` and a much smaller property set) and gauge (it needed `gaugetype`, `angle`, `autoOrientation`, `paletteProgressColor` and `segmentInfo`).

When you have verified something, record it: the Qlik Sense version, the inventory, the screenshots, and what you looked at. Then update this page and the `renderVerified` flag for the type (see [architecture.md](architecture.md#adding-a-chart-type)).
