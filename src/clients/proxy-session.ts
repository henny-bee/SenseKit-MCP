import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { trustedCa, vpPath, type Config } from "../config.js";
import { ToolError } from "../core/errors.js";

export interface ProxyCredentials {
  cookie: string;
  /** "" when the proxy predates CSWSH protection and issues no token. */
  csrfToken: string;
}

/** Test seam: how a session is bootstrapped (default: the real GET
 *  /{prefix}/qps/csrftoken in jwt mode, the login form in windows mode) and
 *  what time it is (default Date.now). */
export interface ProxySessionOptions {
  bootstrap?: (cfg: Config) => Promise<ProxyCredentials>;
  now?: () => number;
}

/** Below this age a 403 or a socket closed at open is NOT taken as a stale
 *  session: a session this fresh cannot have expired (the QMC minimum session
 *  timeout is one minute), so the cause is a security-rule denial or a real
 *  engine fault. Without this, every rule-denied call would mint a new proxy
 *  session and run into OnMaxParallelSessionsExceeded. A 401 always retries. */
export const STALE_SESSION_MIN_AGE_MS = 60_000;

/** Is `e` the proxy rejecting our session? 401/403 from QRS (status in
 *  details), a 401/403 on the engine websocket upgrade, or the engine socket
 *  closing before the session opened. Returns the HTTP status when known. */
export function sessionRejection(e: unknown): { status?: number } | undefined {
  if (!(e instanceof ToolError)) return undefined;
  const status = e.details?.status;
  if (status === 401 || status === 403) return { status };
  // A forms-login proxy answers a request without a valid session with a
  // redirect to its login page instead of a 401: same meaning, same retry.
  if (typeof status === "number" && status >= 300 && status < 400) return { status: 401 };
  if (e.code === "AUTH_ERROR") {
    const m = /\b(40[13])\b/.exec(e.message);
    return m ? { status: Number(m[1]) } : undefined;
  }
  if (e.code === "ENGINE_ERROR" && /engine session open failed/.test(e.message) && /socket closed|closed before|unexpected server response/i.test(e.message)) {
    return {};
  }
  return undefined;
}

/**
 * JWT-mode session bootstrap.
 *
 * A Qlik virtual proxy protects WebSocket upgrades with a CSRF check
 * ("Cross-Site Websocket Hijacking prevention"). Presenting the JWT as a
 * bearer token on the upgrade is rejected — the proxy expects the same thing a
 * browser sends: an established session cookie plus a server-issued CSRF token
 * as the `qlik-csrf-token` query parameter.
 *
 * GET /{prefix}/qps/csrftoken authenticates the JWT once and returns both: the
 * session in Set-Cookie and the token in a `qlik-csrf-token` response header.
 *
 * Reusing the result matters. Every bearer-authenticated request mints a fresh
 * Qlik session, and users have a parallel-session limit — re-authenticating per
 * call exhausts it and the engine answers OnMaxParallelSessionsExceeded.
 */
export class ProxySession {
  private creds?: ProxyCredentials;
  private issuedAt = 0;
  private inFlight?: Promise<ProxyCredentials>;
  private readonly bootstrapFn: (cfg: Config) => Promise<ProxyCredentials>;
  private readonly now: () => number;
  /** Bootstraps performed so far (diagnostics and tests). */
  bootstraps = 0;

  constructor(private cfg: Config, opts: ProxySessionOptions = {}) {
    this.bootstrapFn = opts.bootstrap ?? (cfg.authMode === "windows" ? formsLogin() : bootstrapCsrf);
    this.now = opts.now ?? Date.now;
  }

  async ensure(): Promise<ProxyCredentials> {
    if (this.creds) return this.creds;
    if (!this.inFlight) {
      this.bootstraps++;
      this.inFlight = this.bootstrapFn(this.cfg)
        .then((c) => { this.creds = c; this.issuedAt = this.now(); return c; })
        .finally(() => { this.inFlight = undefined; });
    }
    return this.inFlight;
  }

  /** Drop cached credentials so the next call re-authenticates. With `stale`,
   *  only when those are still the cached ones: concurrent callers that all
   *  saw the same dead session trigger ONE re-bootstrap, not one each. */
  invalidate(stale?: ProxyCredentials): void {
    if (stale && this.creds !== stale) return;
    this.creds = undefined;
  }

  /** Run `op` with the session credentials. If the proxy rejects the session
   *  (see sessionRejection), invalidate it and retry ONCE with a freshly
   *  bootstrapped one; a second failure is returned as is (never loops). The
   *  session stays cached across calls, so normal traffic uses one session. */
  async run<T>(op: (creds: ProxyCredentials) => Promise<T>): Promise<T> {
    const creds = await this.ensure();
    const age = this.now() - this.issuedAt;
    try {
      return await op(creds);
    } catch (e) {
      const rejection = sessionRejection(e);
      if (!rejection) throw e;
      if (rejection.status !== 401 && age < STALE_SESSION_MIN_AGE_MS) throw e;
      this.invalidate(creds);
      return await op(await this.ensure());
    }
  }
}

/** GET /{prefix}/qps/csrftoken with the JWT: the session cookie comes back
 *  in Set-Cookie, the CSRF token in a `qlik-csrf-token` header. */
function bootstrapCsrf(cfg: Config): Promise<ProxyCredentials> {
  const ca = trustedCa(cfg);
  return new Promise<ProxyCredentials>((resolve, reject) => {
    const req = https.request({
      host: cfg.host,
      port: cfg.proxyPort,
      method: "GET",
      path: `${vpPath(cfg)}/qps/csrftoken`,
      headers: { Authorization: `Bearer ${cfg.jwt}`, Accept: "*/*", Connection: "close" },
      rejectUnauthorized: cfg.tlsVerify,
      ...(ca ? { ca } : {}),
      // The proxy closes this connection after the 204; keeping it out of the
      // pool stops the next request from inheriting a dead socket.
      agent: false,
    }, (res) => {
      res.resume(); // drain
      res.on("end", () => {
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new ToolError("AUTH_ERROR", `CSRF bootstrap GET ${vpPath(cfg)}/qps/csrftoken -> ${res.statusCode}`, { status: res.statusCode }));
          return;
        }
        const csrfToken = res.headers["qlik-csrf-token"];
        const sessionCookie = qlikSessionCookie(res.headers["set-cookie"]);
        if (typeof csrfToken !== "string" || !csrfToken) {
          reject(new ToolError("AUTH_ERROR", "CSRF bootstrap: no qlik-csrf-token response header"));
          return;
        }
        if (!sessionCookie) {
          reject(new ToolError("AUTH_ERROR", "CSRF bootstrap: no X-Qlik-Session cookie returned"));
          return;
        }
        resolve({ cookie: sessionCookie, csrfToken });
      });
    });
    req.on("error", (e) => reject(new ToolError("PROXY_ERROR", e.message)));
    req.end();
  });
}

/** The Qlik session cookie (`X-Qlik-Session`, or `X-Qlik-Session-<suffix>`
 *  on a prefixed proxy) from Set-Cookie, as a `name=value` pair. */
function qlikSessionCookie(setCookie: string[] | undefined): string | undefined {
  return (setCookie ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("X-Qlik-Session"));
}

/** One request to the proxy with redirects NOT followed: each login step
 *  reads the Location itself and checks it before sending anything there. */
function proxyRequest(
  cfg: Config,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: IncomingHttpHeaders }> {
  const ca = trustedCa(cfg);
  const length = opts.body !== undefined ? { "Content-Length": String(Buffer.byteLength(opts.body)) } : {};
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: cfg.host,
      port: cfg.proxyPort,
      method: opts.method ?? "GET",
      path,
      headers: { Accept: "*/*", Connection: "close", ...opts.headers, ...length },
      rejectUnauthorized: cfg.tlsVerify,
      ...(ca ? { ca } : {}),
      agent: false,
    }, (res) => {
      res.resume(); // drain
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on("error", (e) => reject(new ToolError("PROXY_ERROR", `windows login: ${e.message}`)));
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/** A login redirect's target as path + query, accepted only on the
 *  configured proxy (https, same host and port): the next steps send the
 *  password and then a one-time ticket there. */
function onProxy(cfg: Config, location: string | undefined, step: string): string | undefined {
  if (!location) return undefined;
  const url = new URL(location, `https://${cfg.host}:${cfg.proxyPort}/`);
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== cfg.host.toLowerCase() || Number(url.port || 443) !== cfg.proxyPort) {
    throw new ToolError("AUTH_ERROR",
      `windows login: ${step} redirected to ${url.protocol}//${url.host}, not the configured proxy ${cfg.host}:${cfg.proxyPort}; ` +
      "nothing was sent there. Set QSEOW_HOST to the host name the proxy redirects to.");
  }
  return url.pathname + url.search;
}

/**
 * windows-mode session bootstrap: the login a browser does on a virtual proxy
 * using Windows authentication with the Form pattern.
 *
 *   1. GET {prefix}/hub/ without a session -> 302 to
 *      /internal_forms_authentication/?targetId=<id>
 *   2. POST username=DOMAIN\user&pwd=... to that URL -> 302 to the hub with a
 *      one-time ?qlikTicket=...
 *   3. GET the ticket URL -> the session in Set-Cookie
 *   4. GET {prefix}/qps/csrftoken with the session -> the qlik-csrf-token
 *      the engine websocket needs (see bootstrapCsrf). A proxy older than
 *      CSWSH protection has no such endpoint and needs no token.
 *
 * A rejected login is remembered: later bootstraps fail at once without
 * contacting the proxy, until the server restarts. Posting a wrong password
 * again on every tool call would lock the Windows account.
 */
function formsLogin(): (cfg: Config) => Promise<ProxyCredentials> {
  let rejected: ToolError | undefined;
  return async (cfg) => {
    if (rejected) throw rejected;
    const { username, password } = cfg.windowsLogin!;
    const vp = vpPath(cfg);

    const start = await proxyRequest(cfg, `${vp}/hub/`);
    const isRedirect = start.status >= 300 && start.status < 400;
    const form = isRedirect ? onProxy(cfg, start.headers.location, `GET ${vp}/hub/`) : undefined;
    if (!form?.includes("/internal_forms_authentication/")) {
      throw new ToolError("AUTH_ERROR",
        `windows login: GET ${vp}/hub/ -> ${start.status}, expected a redirect to the Qlik login form. ` +
        "Is this virtual proxy set to Windows authentication with the Form pattern (QSEOW_VP_PREFIX selects the proxy)?");
    }

    const login = await proxyRequest(cfg, form, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, pwd: password }).toString(),
    });
    if (login.status >= 500) throw new ToolError("PROXY_ERROR", `windows login: POST login form -> ${login.status}`);
    const ticket = login.status >= 300 && login.status < 400 ? onProxy(cfg, login.headers.location, "the login") : undefined;
    if (!ticket || !/[?&]qlikTicket=/.test(ticket)) {
      rejected = new ToolError("AUTH_ERROR",
        `windows login rejected for ${username} (POST login form -> ${login.status}). Check QSEOW_USERNAME (DOMAIN\\user) ` +
        "and the password, then restart the MCP server. A rejected login is not retried, so the account cannot be locked out by repeated attempts.");
      throw rejected;
    }

    const redeem = await proxyRequest(cfg, ticket);
    const cookie = qlikSessionCookie(redeem.headers["set-cookie"]);
    if (!cookie) throw new ToolError("AUTH_ERROR", `windows login: redeeming the login ticket -> ${redeem.status}, no X-Qlik-Session cookie returned`);

    const csrf = await proxyRequest(cfg, `${vp}/qps/csrftoken`, { headers: { Cookie: cookie } });
    if (csrf.status >= 300 && csrf.status !== 404) {
      throw new ToolError("AUTH_ERROR", `windows login: GET ${vp}/qps/csrftoken -> ${csrf.status} with the new session`);
    }
    const token = csrf.headers["qlik-csrf-token"];
    return { cookie, csrfToken: typeof token === "string" ? token : "" };
  };
}
