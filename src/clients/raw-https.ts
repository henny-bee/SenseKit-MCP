import https from "node:https";
import { randomBytes } from "node:crypto";
import { trustedCa, type Config } from "../config.js";
import { ToolError, errMsg } from "../core/errors.js";

/** Raw HTTPS request outside the QRS client's routing: the engine healthcheck
 *  and the Proxy Service (QPS) REST API live on their own ports. QPS is
 *  certificate-only; the healthcheck follows the configured auth mode.
 *  Socket-level failures retry once on a fresh connection (same rationale as
 *  QrsClient). */
export async function rawRequest(
  cfg: Config,
  opts: {
    port: number; path: string; method?: string; useCert?: boolean; cookie?: string;
    /** Error code for a network-level failure (refused, TLS, reset). */
    service?: "ENGINE_ERROR" | "PROXY_ERROR";
  },
): Promise<{ status: number; body: string }> {
  const network = (e: unknown) => new ToolError(opts.service ?? "PROXY_ERROR", errMsg(e), { port: opts.port });
  try {
    return await rawAttempt(cfg, opts);
  } catch (e) {
    if (!/socket hang up|ECONNRESET|EPIPE|socket closed/i.test(errMsg(e))) throw network(e);
    try {
      return await rawAttempt(cfg, opts);
    } catch (e2) {
      throw network(e2);
    }
  }
}

function rawAttempt(
  cfg: Config,
  opts: {
    port: number;
    path: string;
    method?: string;
    useCert?: boolean;
    cookie?: string;
  },
): Promise<{ status: number; body: string }> {
  const xrf = randomBytes(8).toString("hex");
  const sep = opts.path.includes("?") ? "&" : "?";
  const headers: Record<string, string> = {
    "x-qlik-xrfkey": xrf,
    Accept: "application/json",
  };
  if (opts.useCert) {
    headers["X-Qlik-User"] = `UserDirectory=${cfg.certUser.directory}; UserId=${cfg.certUser.id}`;
  } else if (opts.cookie) {
    headers.Cookie = opts.cookie;
  }
  const ca = trustedCa(cfg);
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: cfg.host,
      port: opts.port,
      method: opts.method ?? "GET",
      path: `${opts.path}${sep}xrfkey=${xrf}`,
      headers,
      rejectUnauthorized: cfg.tlsVerify,
      ...(ca ? { ca } : {}),
      ...(opts.useCert && cfg.cert
        ? { cert: cfg.cert.cert, key: cfg.cert.key, passphrase: cfg.cert.passphrase }
        : {}),
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}
