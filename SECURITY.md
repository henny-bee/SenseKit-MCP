# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for anything that could be exploited.

Report it privately instead, by either:

- GitHub private vulnerability reporting: **Security → Report a vulnerability** on https://github.com/OWNER/qlik-sense-mcp, or
- email to **SECURITY-CONTACT@example.com**.

Include the version, the auth mode, the tool involved, and the smallest reproduction you can share. Do not send real hostnames, certificates, tokens or connection strings; synthetic values are enough.

You should get an acknowledgment within a few working days. This is a volunteer-maintained project, so there is no formal response-time guarantee.

## Supported versions

Security fixes go into the latest released version. Older versions are not patched.

## Scope

In scope: this server's code, its handling of credentials and Qlik data, its tool gating, and the packaging files in this repository (npm package, `server.json`, the Claude Desktop bundle manifest).

Out of scope: Qlik Sense itself, the MCP client you use, and the configuration of your Qlik site (virtual proxies, security rules, certificates). Report Qlik product issues to Qlik.

Credential redaction that can be bypassed, so that a secret leaves the server unmasked, is a security bug. Please report it as described above.

## Design posture

- **Read-only by default.** Write tools are not registered unless `QSEOW_ALLOW_MUTATIONS=true`, so a read-only deployment's `tools/list` contains no tool that can change anything. [docs/tools.md](docs/tools.md) marks every mutation-gated tool.
- **Honest annotations.** Every tool declares MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) so clients can apply their own confirmation policy. No tool reaches outside the configured Qlik site (`openWorldHint: false`).
- **Credential redaction on egress.** Secrets are masked before data leaves the server:
  - QRS entities, both by field name (`password`, `passphrase`, `secret`, `apikey`, tokens and similar names, including prefixed ones such as `oidcClientSecret`) and in name/value setting pairs;
  - `key=value` secrets embedded in connection strings and free text (`PWD=...`, `apikey=...`);
  - load scripts (`get_script`), script and expression snippets (`search_expressions`), reload logs (`get_reload_log`) and reload progress (`reload_app`);
  - object properties (`get_object_properties`) and the builder's responses (`validate_sheet`, `add_sheet_object`, `update_sheet_object`, `delete_master_item`).

  Empty credential fields are passed through, because "no credential is set" is useful information. `set_script` refuses a script that contains the redaction marker, so a masked script cannot overwrite real credentials by being written back.
- **Input validation.** App and task ids are interpolated into QRS URLs and engine WebSocket paths, so they must be GUIDs. That is checked in the tool schemas, and app ids are checked again in the engine client.
- **Guarded destructive operations.** `update_sheet_object` refuses types the builder does not construct (rebuilding them would discard their properties). `delete_master_item` refuses while charts still link to the item, unless forced. `move_sheet_object` and `delete_sheet_object` check that the object belongs to the given sheet.
- **No header authentication.** Identity comes from QMC-exported client certificates or a signed, expiring JWT. Header-authentication virtual proxies let any client claim any identity and are deliberately unsupported.
- **TLS verification on by default.** `QSEOW_TLS_VERIFY=false` exists only for lab sites with self-signed certificates.

## Deploying safely

- Run the server under a dedicated Qlik identity with the narrowest access that serves your use case.
- Expose only the tool groups you need (`QSEOW_TOOL_GROUPS`).
- Certificate mode with the default internal account has very broad access. Prefer jwt mode when the agent should be limited by a real user's security rules and section access. See [docs/authentication.md](docs/authentication.md), including the trust model for the JWT signing key.
- Keep certificates, keys, tokens and `.env` files out of version control and out of issue reports.
- Enable `QSEOW_ALLOW_MUTATIONS` only on a deployment that needs it, and preferably against a non-production site first.
- Remember that whatever a tool returns goes into the MCP client's transcript and, from there, to the model provider. Redaction covers credentials; it does not hide business data the identity is allowed to read.
