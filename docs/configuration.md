# Configuration

SenseKit-MCP is configured only through environment variables. They all start with `QSEOW_` because they name the Qlik product (Qlik Sense Enterprise on Windows, QSEoW). They are read once, at startup, in `src/config.ts`.

## Where values come from

1. The process environment. In practice this is the `env` block of your MCP client config (Claude Desktop, Claude Code, and so on).
2. A `.env` file, used only for variables that are **not** already set in the environment. The server reads the file named by `QSEOW_ENV_PATH` if that is set, otherwise `./.env` in the working directory if one exists, otherwise nothing.

The `.env` format is simple: `KEY=VALUE` lines, an optional `export ` prefix, `#` comment lines, and optional single or double quotes around the value. An empty value counts as unset, so the default applies. Comments must be on a line of their own: everything after `=` is the value, so a trailing `# comment` or trailing spaces become part of it (`QSEOW_HOST=sense.example.com  # host` sets the host to `sense.example.com  # host`).

MCP clients choose the working directory of the server process, so a relative `./.env` may not be found. Either put the variables in the client's `env` block or set `QSEOW_ENV_PATH` to an absolute path.

Copy [`.env.example`](../.env.example) as a starting point. Never commit a real `.env` or certificate files; the repository's `.gitignore` already excludes `.env`, `*.pem`, `*.key`, `*.pfx`, `*.crt` and `certs/`.

## Reference

### Site and ports

| Variable | Default | Meaning |
|---|---|---|
| `QSEOW_HOST` | `localhost` | Hostname of the Qlik Sense node, without a scheme (for example `sense.example.com`). Every connection goes to this host. |
| `QSEOW_QRS_PORT` | `4242` | Repository Service (QRS) port. Used in certificate mode. |
| `QSEOW_ENGINE_PORT` | `4747` | Engine (QIX) WebSocket port. Used in certificate mode, also for the engine health check. |
| `QSEOW_PROXY_PORT` | `443` | Proxy port of the virtual proxy. In jwt and windows mode, QRS, engine and health-check traffic all go through it. |
| `QSEOW_QPS_PORT` | `4243` | Proxy Service REST API port. Used only by `list_user_sessions` and `end_user_sessions`, which always use certificate authentication. |

Port values are passed to `Number()` and are not otherwise validated.

### Authentication

See [authentication.md](authentication.md) for how the three modes work and which to choose.

| Variable | Default | Meaning |
|---|---|---|
| `QSEOW_AUTH_MODE` | `certificate` | `certificate`, `jwt` or `windows`. Any other value stops the server at startup. |
| `QSEOW_CERT_PATH` | none | Path to the QMC-exported client certificate (PEM). **Required in certificate mode.** In jwt and windows mode it is optional; if it is set together with the key, both files are loaded (so they must exist) and the certificate-only session tools are registered too. |
| `QSEOW_CERT_KEY_PATH` | none | Path to the client certificate's private key (PEM). Always used together with `QSEOW_CERT_PATH`: outside certificate mode, if only one of the two is set, neither is loaded. |
| `QSEOW_CERT_PASSPHRASE` | none | Passphrase for the private key, if it has one. |
| `QSEOW_ROOT_CERT_PATH` | none | Path to the CA (PEM) that signed the Qlik server certificates, usually the Qlik root CA. Loaded in every auth mode, with or without client-certificate files, and trusted on every TLS connection. See [TLS trust](#tls-trust). |
| `QSEOW_CERT_USER_DIRECTORY` | `INTERNAL` | User directory sent in the `X-Qlik-User` header on certificate-authenticated calls. |
| `QSEOW_CERT_USER_ID` | `sa_repository` | User id sent in the `X-Qlik-User` header on certificate-authenticated calls. Prefer a dedicated, least-privilege account where your site allows it. |
| `QSEOW_JWT` | none | A signed JWT for the virtual proxy. In jwt mode one of `QSEOW_JWT` or `QSEOW_JWT_PATH` is required. |
| `QSEOW_JWT_PATH` | none | Path to a file that contains the JWT. Read only when `QSEOW_JWT` is empty. Surrounding whitespace is trimmed. |
| `QSEOW_VP_PREFIX` | `jwt`; none in windows mode | Prefix of the virtual proxy, as in `https://host/<prefix>/`. In windows mode the default is the unprefixed default proxy. |
| `QSEOW_USERNAME` | none | Windows account for windows mode, as `DOMAIN\user`. **Required in windows mode.** |
| `QSEOW_PASSWORD` | none | The account's password. In windows mode one of `QSEOW_PASSWORD` or `QSEOW_PASSWORD_PATH` is required. |
| `QSEOW_PASSWORD_PATH` | none | Path to a file that contains the password. Read only when `QSEOW_PASSWORD` is empty. A leading BOM and one trailing newline are removed; other whitespace is kept. |

The server fails at startup, before it registers any tool, if certificate mode is missing either path, if jwt mode has no token, if windows mode has no username or password or the username is not `DOMAIN\user`, if a configured file cannot be read, or if `QSEOW_AUTH_MODE` has an unknown value.

### Safety

| Variable | Default | Meaning |
|---|---|---|
| `QSEOW_ALLOW_MUTATIONS` | `false` | Only the exact string `true` enables write tools. Otherwise they are **never registered**, so they are missing from `tools/list` (not merely refused when called). [tools.md](tools.md) marks each one as mutation-gated. |
| `QSEOW_TOOL_GROUPS` | `analyst,developer,admin` | Comma-separated tool groups (personas) to register. Matching ignores case and surrounding spaces. Unknown names are ignored, and an empty value means the default (all three). |
| `QSEOW_TLS_VERIFY` | `true` | Only the exact string `false` turns off server-certificate verification. Use that only on a lab site with self-signed certificates. |

### Loader

| Variable | Default | Meaning |
|---|---|---|
| `QSEOW_ENV_PATH` | none | Absolute path to a `.env` file to read instead of `./.env`. If it is set but the file cannot be read, startup fails. |

## TLS trust

When `QSEOW_ROOT_CERT_PATH` is set, the CA it names is trusted on every TLS connection the server makes, in every auth mode:

- QRS, directly on 4242 or through the virtual proxy;
- the jwt-mode session bootstrap (`/qps/csrftoken`) and the windows-mode login;
- the engine WebSocket, directly on 4747 or through the virtual proxy;
- the engine health check;
- the Proxy Service API on 4243.

So if your virtual proxy presents a certificate from Qlik's own CA or an internal CA, set `QSEOW_ROOT_CERT_PATH` to that CA rather than turning off `QSEOW_TLS_VERIFY`.

## What the startup line tells you

On start, the server prints one line to stderr with the host, auth mode, enabled groups, and whether mutations are enabled or read-only. MCP clients usually show this in their server log. Check it first when a tool you expect is missing.

## Variables used only by the scripts

These are read by the developer scripts in `scripts/`, not by the server.

| Variable | Used by | Meaning |
|---|---|---|
| `JWT_PATH` | `scripts/render_proof.mjs` | Path to a file containing a signed JWT for the virtual proxy. Required. |
| `SHOTS` | `scripts/render_proof.mjs` | Directory for screenshots. When set, one PNG is saved per object and size. |
| `SMOKE_APP_NAME` | `scripts/smoke.mjs` | Name of the demo app the smoke test creates. Default `MCP Smoke Demo`. |

The scripts that start the server (`smoke.mjs`, `viz_matrix.mjs`) pass their own environment through, so they use the `QSEOW_*` variables above. `render_proof.mjs` reads `QSEOW_HOST`, `QSEOW_PROXY_PORT`, `QSEOW_VP_PREFIX` and `QSEOW_TLS_VERIFY` directly.
