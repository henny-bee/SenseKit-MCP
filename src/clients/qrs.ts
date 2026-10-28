import https from "node:https";
import { randomBytes } from "node:crypto";
import { trustedCa, usesProxySession, vpPath, type Config } from "../config.js";
import type { ProxySession, ProxyCredentials } from "./proxy-session.js";
import { ToolError, httpErrorCode } from "../core/errors.js";

export class QrsClient {
  constructor(private cfg: Config, private session?: ProxySession) {}

  private xrfkey(): string {
    return randomBytes(8).toString("hex"); // QRS requires exactly 16 chars
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    if (usesProxySession(this.cfg) && this.session) {
      return this.session.run((creds) => this.withSocketRetry<T>(method, path, body, creds));
    }
    return this.withSocketRetry<T>(method, path, body);
  }

  // The proxy may have closed a pooled socket; one retry on a fresh one clears it.
  private async withSocketRetry<T>(method: string, path: string, body: unknown, creds?: ProxyCredentials): Promise<T> {
    try {
      return await this.attempt<T>(method, path, body, creds);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/socket hang up|ECONNRESET|EPIPE|socket closed/i.test(msg)) {
        return await this.attempt<T>(method, path, body, creds);
      }
      throw e;
    }
  }

  private async attempt<T = unknown>(method: string, path: string, body?: unknown, creds?: ProxyCredentials): Promise<T> {
    const cfg = this.cfg;
    const xrf = this.xrfkey();
    const viaProxy = usesProxySession(cfg);
    const port = viaProxy ? cfg.proxyPort : cfg.qrsPort;
    const prefix = viaProxy ? vpPath(cfg) : "";
    const sep = path.includes("?") ? "&" : "?";
    const fullPath = `${prefix}${path}${sep}xrfkey=${xrf}`;

    const headers: Record<string, string> = {
      "x-qlik-xrfkey": xrf,
      Accept: "application/json",
    };
    if (viaProxy) {
      if (creds) {
        headers.Cookie = creds.cookie;
      } else if (cfg.jwt) {
        headers.Authorization = `Bearer ${cfg.jwt}`;
      }
    } else {
      headers["X-Qlik-User"] = `UserDirectory=${cfg.certUser.directory}; UserId=${cfg.certUser.id}`;
    }
    let payload: string | undefined;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }

    const ca = trustedCa(cfg);
    const options: https.RequestOptions = {
      host: cfg.host,
      port,
      method,
      path: fullPath,
      headers,
      rejectUnauthorized: cfg.tlsVerify,
      ...(ca ? { ca } : {}),
      ...(cfg.cert && !viaProxy
        ? { cert: cfg.cert.cert, key: cfg.cert.key, passphrase: cfg.cert.passphrase }
        : {}),
    };

    return new Promise<T>((resolve, reject) => {
      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          // QRS never redirects: via a forms-login proxy a redirect means no session.
          if (viaProxy && res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
            reject(new ToolError("AUTH_ERROR", `QRS ${method} ${path} -> ${res.statusCode}: redirected to the proxy login, the session is not authenticated`,
              { status: res.statusCode, method, path }));
            return;
          }
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new ToolError(httpErrorCode(res.statusCode, "QRS_ERROR"), `QRS ${method} ${path} -> ${res.statusCode}: ${text.slice(0, 500)}`,
              { status: res.statusCode, method, path }));
            return;
          }
          if (!text) { resolve(undefined as T); return; }
          try { resolve(JSON.parse(text) as T); } catch { resolve(text as unknown as T); }
        });
      });
      req.on("error", (e) => reject(new ToolError("QRS_ERROR", e.message, { method, path })));
      if (payload) req.write(payload);
      req.end();
    });
  }

  get<T = unknown>(path: string) { return this.request<T>("GET", path); }
  post<T = unknown>(path: string, body?: unknown) { return this.request<T>("POST", path, body); }
  put<T = unknown>(path: string, body?: unknown) { return this.request<T>("PUT", path, body); }
  delete<T = unknown>(path: string) { return this.request<T>("DELETE", path); }
}
