# Errors

When a tool call fails, the result has `isError: true` and one text content item whose text is a JSON object:

```json
{
  "code": "NOT_FOUND",
  "message": "refusing to create: dimension field(s) not in the data model: Regoin",
  "details": { "missingFields": ["Regoin"] }
}
```

- `code` is one of the fixed values below. Branch on it rather than on the message.
- `message` is meant for people. Its wording is kept stable, so existing scripts and runbooks that look for phrases such as `refusing to create:` or `not in the data model` keep working.
- `details` is optional and depends on the error. Typical contents are listed below.

All errors pass through one boundary (`src/tools/error-boundary.ts`) that wraps every tool handler. Error text is an egress path too (a QRS error body can echo a connection string), so the payload is redacted like any other output.

## Two kinds of failure that are not structured errors

- **Invalid arguments.** If the arguments don't match the tool's input schema (a missing required field, a wrong type, an id that isn't a GUID), the MCP SDK rejects the call before the handler runs. Those keep the SDK's own plain-text error, `MCP error -32602: Input validation error: ...`, not the JSON shape.
- **Gate verdicts.** A chart that the validation gate fails is not an error. `add_sheet_object` succeeds, and its result carries `validation.status: "fail"` with findings, because the object was created and you need its id to fix or delete it. `validate_sheet` likewise returns a `verdict`. See [chart-building.md](chart-building.md#the-validation-gate).

## Codes

| Code | Meaning | Examples | Typical `details` |
|---|---|---|---|
| `INVALID_INPUT` | The request is malformed: arguments are missing, contradictory or badly formed in a way the schema cannot express. | Not exactly one of `field`/`expression`/`libraryId`; empty expression; bad hex color; `colorMode: "single"` without `color`; `numberFormat` `custom` without a pattern; `validate_sheet` without `sheetId` or `objectId`; `update_sheet_object` with nothing to update. | none |
| `NOT_FOUND` | Something the request refers to does not exist. | Dimension field not in the data model; unknown master-item id; object is not a child of the given sheet; stream not found; master measure not found by title; QRS answered 404. | `missingFields`, `masterDimensionIds`, `masterMeasureIds`, `objectId` + `sheetId`, `streamName`, `kind` + `id`, `status` |
| `VALIDATION_REFUSED` | A pre-flight or safety check refused the change. | Chart shape outside the type's range; calculated dimension or master-dimension field with expression findings; measure syntax error; master measure with an unknown field; `set_script` with the redaction marker; `update_sheet_object` on a type the builder does not build. | `visualization` + `findings`, `dimension`/`measure` index + `expression` + `warnings`/`errors`, `expression` + `warnings` |
| `REFERENCED` | Refused because other objects still depend on the target. | `delete_master_item` while charts link to the item (pass `force: true` to override). | `kind`, `id`, `references` (each with object id, type, title and owning sheet where known) |
| `CONFLICT` | The change would collide with something that exists. | Duplicate master-measure or master-dimension title. | `existingId` |
| `ENGINE_ERROR` | The Qlik engine (QIX) failed or refused the operation. | Engine session or `OpenDoc` failed; the engine refused to create an app or destroy an item; an engine JSON-RPC error; engine health check returned an error status. | `engineCode` (the engine's numeric error code), `kind` + `id`, `status` |
| `QRS_ERROR` | The Repository Service returned an error, or could not be reached. | Any QRS status of 400 or above other than 401, 403 and 404; a network error on a QRS call. | `status`, `method`, `path` |
| `PROXY_ERROR` | The Proxy Service (QPS) returned an error, or the proxy could not be reached. | `list_user_sessions` / `end_user_sessions` failed; network error during the jwt-mode session bootstrap. | `status`, `port` |
| `AUTH_ERROR` | Authentication or authorization failed. | Any HTTP 401 or 403 from QRS, the engine health check or QPS; the engine refused the connection with 401/403; jwt-mode bootstrap (`/qps/csrftoken`) failed or returned no CSRF token or session cookie. | `status` |
| `INTERNAL` | Anything unexpected. This is a bug, not a user error; please report it. | An exception the code did not anticipate. | none |

HTTP statuses map the same way for every Qlik REST service: 401 and 403 become `AUTH_ERROR`, 404 becomes `NOT_FOUND`, and any other error status becomes that service's own code.

## What to do with each code

| Code | Usual next step |
|---|---|
| `INVALID_INPUT` | Fix the arguments; the message names the offending input (for example `measures[1]`). |
| `NOT_FOUND` | Look the item up (`get_app_data_model`, `list_master_measures`, `get_sheet_objects`, ...) and retry with a real name or id. |
| `VALIDATION_REFUSED` | Fix the definition the message points to. Nothing was written. |
| `REFERENCED` | Re-point or delete the objects in `details.references`, or pass `force: true` knowingly. |
| `CONFLICT` | Choose another title, or use the existing item (`details.existingId`). |
| `ENGINE_ERROR`, `QRS_ERROR`, `PROXY_ERROR` | Check the site and the message; retrying may help for transient failures. |
| `AUTH_ERROR` | Check certificates, the token, the virtual proxy and the identity's access. See [authentication.md](authentication.md). |
| `INTERNAL` | Report it, with the message and the tool call (without secrets). |

The authoritative list of codes, with a comment on each, is `ERROR_CODES` in `src/core/errors.ts`. A new code is added only when a caller would act differently on it than on every existing one.
