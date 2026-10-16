# Authentication

SenseKit-MCP supports three standard Qlik Sense Enterprise on Windows authentication patterns, chosen with `QSEOW_AUTH_MODE`:

| | `certificate` (default) | `jwt` | `windows` |
|---|---|---|---|
| Identity | A service identity you name with `QSEOW_CERT_USER_DIRECTORY` / `QSEOW_CERT_USER_ID` (default `INTERNAL\sa_repository`) | The user named in the signed token's claims | The Windows account in `QSEOW_USERNAME` |
| Transport | QRS directly on `:4242`, engine directly on `:4747` | Everything through a JWT virtual proxy on `:443` (`QSEOW_PROXY_PORT`) | Everything through a Windows-authentication virtual proxy on `:443`, by default the unprefixed one |
| Credentials | QMC-exported client certificate and key (PEM) | A signed, expiring JWT (`QSEOW_JWT` or `QSEOW_JWT_PATH`) | The account's password (`QSEOW_PASSWORD` or `QSEOW_PASSWORD_PATH`) |
| Security rules | The service identity's access applies. With the default internal account, that is far broader than a normal user's. | The user's security rules, stream access and section access apply | The user's security rules, stream access and section access apply |
| Needs a Qlik admin | Yes, to export the certificates | Yes, to set up the virtual proxy and its signing key | No: it logs in like the hub's login page |
| Best for | A desktop or server install run by an administrator | An agent that should see only what a specific user (or a dedicated service user) may see | A user on a site that only offers the Windows login form |

Header-authentication virtual proxies are deliberately **not** supported. Any client that can reach such a proxy can claim any identity, which is not a safe basis for an agent tool.

All variables are listed in [configuration.md](configuration.md).

## Certificate mode

1. Export certificates in the QMC: **Certificates → Export**, choose the PEM format. You can also export them through the QRS API (`POST /qrs/certificatedistribution/exportcertificates`).
2. Point the server at the files:

   ```ini
   QSEOW_AUTH_MODE=certificate
   QSEOW_CERT_PATH=/absolute/path/client.pem
   QSEOW_CERT_KEY_PATH=/absolute/path/client_key.pem
   QSEOW_ROOT_CERT_PATH=/absolute/path/root.pem
   ```

   `QSEOW_ROOT_CERT_PATH` is not specific to certificate mode: in jwt and windows mode it is also used to verify the proxy's certificate.

3. Optionally choose the identity the server asserts in the `X-Qlik-User` header with `QSEOW_CERT_USER_DIRECTORY` and `QSEOW_CERT_USER_ID`.

Supply `root.pem` so that TLS verification can stay on. Treat the client certificate and key as administrator credentials: anyone holding them can call the QRS and engine directly as any identity they put in the header.

## JWT mode

```ini
QSEOW_AUTH_MODE=jwt
# the virtual proxy prefix, as in https://host/jwt/
QSEOW_VP_PREFIX=jwt
QSEOW_JWT_PATH=/absolute/path/token.jwt
```

The token is "bring your own": your JWT virtual proxy decides which claims map to the Qlik user id and directory, and checks the signature against the certificate configured on the proxy. The user in the token needs a license allocation (Professional or another type that permits what you want the agent to do). Without one, the engine refuses to open apps, and the client only sees the socket close.

### The certificate-only exception

The Proxy Service REST API (`:4243`), which `list_user_sessions` and `end_user_sessions` use, accepts only certificate authentication. Qlik offers no JWT route to it. Those two tools are registered whenever `QSEOW_CERT_PATH` and `QSEOW_CERT_KEY_PATH` are set, in **any** mode, and are missing from `tools/list` otherwise. All other tools work the same way in both modes.

### The engine WebSocket and CSWSH protection

A virtual proxy protects WebSocket upgrades against Cross-Site WebSocket Hijacking (CSWSH). Sending the JWT as a bearer token on the upgrade request is rejected with a `403` and an empty body. The proxy wants what a browser would send. The server does this for you (`src/clients/proxy-session.ts`, `src/clients/engine.ts`):

1. `GET /{prefix}/qps/csrftoken` with `Authorization: Bearer <jwt>`. The response carries the CSRF token in a `qlik-csrf-token` **response header** (not in a cookie) and the Qlik session in `Set-Cookie` (`X-Qlik-Session...`).
2. The WebSocket is opened at `wss://host:port/{prefix}/app/<appId or engineData>?qlik-csrf-token=<token>` with that **session cookie**, not the bearer token.

QRS calls in jwt mode reuse the same session cookie.

The server bootstraps this once and reuses it. That matters for more than speed: each bearer-authenticated request creates a new Qlik proxy session, users have a limit on parallel sessions, and re-authenticating on every call eventually makes the engine answer `OnMaxParallelSessionsExceeded`. With the cached cookie, all engine sockets (one per open app, plus one without an app) share one proxy session.

If the proxy later rejects that session (it expired, or the proxy restarted), the server recovers without a restart. This covers QRS calls, opening engine sockets, and the proxy leg of `engine_healthcheck`:

- On a **401**, the server always drops the proxy session, bootstraps a new one and retries the operation once.
- On a **403**, or an engine socket that closes before the session opens, it does the same only when the session is more than **60 seconds** old. A fresh session can't have expired, so a 403 then is a security-rule denial, and retrying would only use up proxy sessions (`OnMaxParallelSessionsExceeded`).
- It never retries more than once. If the retry fails too, the error is returned, usually as `AUTH_ERROR`. Concurrent calls that hit the same dead session share one re-bootstrap.

An engine socket that was already open and then dies is removed from the cache when it closes, and the next tool call for that app opens a new one (with the same single retry). A call that was in flight on the dying socket is not replayed; it returns its error. Selections held in that app session are lost.

If you are debugging a similar `403`, these were found **not** to be the cause: the `Origin` header (a browser sends one with a port, and it is accepted), `Host`, ports, tunnels or port forwards, `xrfkey`, and the virtual proxy's `websocketCrossOriginWhiteList` (it takes bare host names and made no difference either way).

One real misconfiguration to check on scripted setups: a virtual proxy created through the QRS API starts with an **empty `loadBalancingServerNodes`** list. No engine is reachable through it until a server node is attached.

To see what the proxy actually receives, turn on its debug log: create `%ProgramData%\Qlik\Sense\Proxy\LocalLogConfig.xml` with a `QSRollingFileAppender` at `threshold=debug` for the `Audit.Proxy`, `System.Proxy` and `Security.Proxy` loggers, then restart the Proxy Service. It logs every request header, so you can compare a working browser upgrade with your client's.

### Minting a test JWT

For testing, sign a short-lived token with the **private** key that matches the certificate on your virtual proxy (RS256). Node 20 or later, no dependencies:

```js
// mint-jwt.mjs  usage: JWT_PRIVATE_KEY_PATH=./vp_key.pem node mint-jwt.mjs > token.jwt
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const key = readFileSync(process.env.JWT_PRIVATE_KEY_PATH, "utf8"); // PEM the proxy trusts
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const header = { alg: "RS256", typ: "JWT" };
const payload = {
  sub: process.env.QLIK_USER_ID || "svc_agent",          // maps to the proxy's user id claim
  directory: process.env.QLIK_USER_DIRECTORY || "QSEOW",  // maps to the proxy's user directory claim
  iat: now,
  exp: now + 3600,                                        // one hour
};
const unsigned = `${b64u(header)}.${b64u(payload)}`;
const sig = createSign("RSA-SHA256").update(unsigned).sign(key).toString("base64url");
process.stdout.write(`${unsigned}.${sig}`);
```

Change the claim names to match your virtual proxy's attribute mapping in the QMC. `sub` and `directory` are only a common choice.

## Windows mode

For a site where people sign in to the hub with their Windows account on a login page (`/internal_forms_authentication/`), no certificates or Qlik admin changes are needed:

```ini
QSEOW_AUTH_MODE=windows
QSEOW_HOST=sense.example.com
QSEOW_USERNAME=DOMAIN\user
# or QSEOW_PASSWORD=<the password>
QSEOW_PASSWORD_PATH=/absolute/path/qlik-password.txt
# see TLS below
QSEOW_ROOT_CERT_PATH=/absolute/path/root.pem
```

The server does what a browser does on that page, once, and caches the result (`src/clients/proxy-session.ts`):

1. `GET /hub/` without a session is redirected to `/internal_forms_authentication/?targetId=...`.
2. `POST` the form fields `username` and `pwd` there. On success the proxy redirects to the hub with a one-time `qlikTicket`.
3. `GET` that ticket URL. The proxy answers with the `X-Qlik-Session` cookie.
4. `GET /qps/csrftoken` with the cookie for the token the engine WebSocket needs (see [CSWSH protection](#the-engine-websocket-and-cswsh-protection)). A release without that protection has no token, and the socket opens without one.

From then on it works like jwt mode: QRS, engine sockets and the health check share the one session cookie. When the session expires, the proxy redirects requests to its login page instead of answering 401. The server treats that redirect like a 401: it logs in again and retries once.

Safeguards:

- **No lockouts.** If the proxy rejects the login, the server remembers it and does not post the password again until it restarts. Without this, every tool call would be a failed login, and the domain would lock the account. Fix the credentials, then restart the server.
- **The password goes to the configured proxy only.** Every redirect in the login is checked against `QSEOW_HOST` and `QSEOW_PROXY_PORT` before anything is sent. A redirect to another host stops the login. If your proxy redirects to a different name for itself, set `QSEOW_HOST` to that name.
- **Username format.** The login form only accepts `DOMAIN\user`, so any other form is rejected at startup rather than spent as a failed login. In a JSON client config, write the backslash as `\\`. In `.env`, write it as a single `\`.
- **Keep the password out of the client config.** Prefer `QSEOW_PASSWORD_PATH`, a file readable only by you. One trailing newline is ignored.
- **TLS.** The password crosses the connection in the form POST, so verify the server. Ask the Qlik admin for the site's root CA certificate (`root.cer` or `root.pem`; it is public, not a secret) and set `QSEOW_ROOT_CERT_PATH`. `QSEOW_TLS_VERIFY=false` still encrypts the connection but does not prove who is on the other end, so anyone able to intercept it could read the password.

The proxy must use Windows authentication with the **Form** pattern for the client. That is what the login page shows. A proxy that answers with an NTLM or Kerberos challenge is not supported. Use `QSEOW_VP_PREFIX` when the login page belongs to a prefixed virtual proxy (`https://host/<prefix>/hub/`).

The user needs a license allocation, and the [published-apps restriction](#published-apps) applies as for any user identity. The certificate-only session tools (`list_user_sessions`, `end_user_sessions`) appear only if certificate files are configured as well.

## Trust model

Read this before you use jwt mode in production.

A JWT virtual proxy accepts any token signed by the private key that matches its configured certificate. That **private key is a master credential**: whoever holds it can mint a token for any identity the proxy will map, just like the signing key of any SAML or OIDC identity provider. This is how JWT single sign-on works; the server adds nothing to it. SenseKit-MCP is only a client that presents a token. Without the private key it cannot impersonate anyone, which is also why publishing the snippet above is harmless: it only works against a proxy whose key you already hold.

Security therefore depends on these points, in order:

1. **Protect the signing key.** Keep it in a secret store or HSM, never in a repository, and rotate it if you suspect exposure.
2. **Authentication is not authorization.** A minted identity is still bound by that user's security rules, stream access and section access. Limit the agent by limiting the Qlik user. This is the main reason to prefer jwt mode over certificate mode with an internal identity.
3. **License.** The identity needs a license allocation before it can do anything.
4. **Short-lived tokens.** A leaked token expires on its own; a leaked key does not. The example above expires after one hour.

The server is also read-only by default (`QSEOW_ALLOW_MUTATIONS=false`), so even a valid identity cannot change anything through it unless you enable write tools.

## Getting tokens in production

The proxy does not authenticate anyone; it trusts whoever holds the signing key to have done that. So the guarantee that "this token belongs to this person" has to come from a **token issuer** outside Qlik that authenticates the person with real credentials (your identity provider, MFA) and puts only that person's identity in the claims. Users authenticate to the issuer; only the issuer holds the key. Common shapes:

- **People working interactively: don't use JWT.** Give them an OIDC or SAML virtual proxy backed by your existing identity provider (for example Entra ID, Okta, Google or ADFS). Adding a user is then an identity-provider and Qlik-license task, with no tokens or keys to handle.
- **A service or agent: one dedicated Qlik identity.** Create a service user (for example `svc_support_agent`), limit it with security rules, and issue tokens only for that identity. The agent acts as itself, not as a person. This is the simplest pattern for an always-on agent.
- **An agent acting for a specific person: a trusted middle tier.** A small service authenticates the person through your identity provider, then mints a short-lived token for that user, so the agent sees exactly what the person may see. Use this only when per-user data scoping through the agent is a hard requirement.

## Published apps

The engine denies a **published** app's load script and lineage to user identities, such as the user in a JWT or the Windows account in windows mode. Internal identities used in certificate mode are not affected. For a published app opened as a user, `get_script` and `get_app_lineage` therefore fail, and `search_expressions` finds no matches in the script. The usual workaround is `copy_app` (mutation-gated) and then to inspect the copy, which carries the same script and definitions.
