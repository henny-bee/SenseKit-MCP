import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { trustedCa, vpPath, type Config } from "../config.js";
import { ToolError } from "../core/errors.js";

export interface ProxyCredentials {
  cookie: string;
  /** "" when the proxy predates CSWSH protection and issues no token. */
  csrfToken: string;
}

export interface ProxySessionOptions {
  bootstrap?: (cfg: Config) => Promise<ProxyCredentials>;
  now?: () => number;
}

// A 403 below QMC's 1-min min timeout is a rule denial, not expiry: don't re-bootstrap.
export const STALE_SESSION_MIN_AGE_MS = 60_000;

export function sessionRejection(e: unknown): { status?: number } | undefined {
  if (!(e instanceof ToolError)) return undefined;
  const status = e.details?.status;
  if (status === 401 || status === 403) return { status };
  // A forms-login proxy redirects to its login page instead of answering 401.
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

// Reuse the session: each bearer request mints a new one and hits the per-user limit.
export class ProxySession {
  private creds?: ProxyCredentials;
  private issuedAt = 0;
  private inFlight?: Promise<ProxyCredentials>;
  private readonly bootstrapFn: (cfg: Config) => Promise<ProxyCredentials>;
  private readonly now: () => number;
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

  // With `stale`, drop only if still cached: concurrent failures re-bootstrap once.
  invalidate(stale?: ProxyCredentials): void {
    if (stale && this.creds !== stale) return;
    this.creds = undefined;
  }

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
      // Proxy closes the socket after the 204; keep it out of the pool.
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

// Prefix match: a prefixed proxy names it X-Qlik-Session-<suffix>.
function qlikSessionCookie(setCookie: string[] | undefined): string | undefined {
  return (setCookie ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("X-Qlik-Session"));
}

// Redirects not followed: each login step checks the Location first.
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

// Only accept redirects to the configured proxy: password and ticket go there.
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

// A rejected login is cached until restart: retrying would lock the Windows account.
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
