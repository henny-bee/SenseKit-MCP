import { readFileSync, existsSync } from "node:fs";

// Never overrides set env vars: the MCP client's explicit env wins.
function loadEnvFile(): void {
  const path = process.env.QSEOW_ENV_PATH ?? (existsSync(".env") ? ".env" : undefined);
  if (!path) return;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    if (process.env.QSEOW_ENV_PATH) throw new Error(`QSEOW_ENV_PATH is set but unreadable: ${path}`);
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

export type AuthMode = "certificate" | "jwt" | "windows";
export type ToolGroup = "analyst" | "developer" | "admin";

export interface Config {
  host: string;
  qrsPort: number;
  enginePort: number;
  proxyPort: number;
  qpsPort: number;
  authMode: AuthMode;
  /** Virtual proxy prefix; "" is the default (unprefixed) proxy. */
  vpPrefix: string;
  jwt?: string;
  windowsLogin?: { username: string; password: string };
  cert?: { cert: Buffer; key: Buffer; passphrase?: string; ca?: Buffer };
  /** QSEOW_ROOT_CERT_PATH; trusted on every connection in every auth mode. */
  ca?: Buffer;
  certUser: { directory: string; id: string };
  tlsVerify: boolean;
  toolGroups: Set<ToolGroup>;
  allowMutations: boolean;
}

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export const trustedCa = (cfg: Config): Buffer | undefined => cfg.ca ?? cfg.cert?.ca;

export const usesProxySession = (cfg: Config): boolean => cfg.authMode !== "certificate";

export const vpPath = (cfg: Config): string => (cfg.vpPrefix ? `/${cfg.vpPrefix}` : "");

export function loadConfig(): Config {
  loadEnvFile();
  const authMode = (env("QSEOW_AUTH_MODE", "certificate") as AuthMode);
  if (authMode !== "certificate" && authMode !== "jwt" && authMode !== "windows") {
    throw new Error(`QSEOW_AUTH_MODE must be "certificate", "jwt" or "windows", got "${authMode}"`);
  }

  // Certs load in any mode when set: QPS (:4243) only speaks certificate auth.
  const caPath = env("QSEOW_ROOT_CERT_PATH");
  const ca = caPath ? readFileSync(caPath) : undefined;
  let cert: Config["cert"];
  const certPath = env("QSEOW_CERT_PATH");
  const keyPath = env("QSEOW_CERT_KEY_PATH");
  if (authMode === "certificate" && (!certPath || !keyPath)) {
    throw new Error("certificate mode requires QSEOW_CERT_PATH and QSEOW_CERT_KEY_PATH");
  }
  if (certPath && keyPath) {
    cert = {
      cert: readFileSync(certPath),
      key: readFileSync(keyPath),
      passphrase: env("QSEOW_CERT_PASSPHRASE"),
      ca,
    };
  }

  let jwt: string | undefined;
  if (authMode === "jwt") {
    jwt = env("QSEOW_JWT");
    const jwtPath = env("QSEOW_JWT_PATH");
    if (!jwt && jwtPath) jwt = readFileSync(jwtPath, "utf8").trim();
    if (!jwt) throw new Error("jwt mode requires QSEOW_JWT or QSEOW_JWT_PATH");
  }

  // The login form needs DOMAIN\user: reject a bare name before it costs a failed login.
  let windowsLogin: Config["windowsLogin"];
  if (authMode === "windows") {
    const username = env("QSEOW_USERNAME");
    let password = env("QSEOW_PASSWORD");
    const passwordPath = env("QSEOW_PASSWORD_PATH");
    // A BOM or final newline would become part of the password.
    if (password === undefined && passwordPath) password = readFileSync(passwordPath, "utf8").replace(/^﻿/, "").replace(/\r?\n$/, "");
    if (!username || !password) throw new Error("windows mode requires QSEOW_USERNAME and QSEOW_PASSWORD (or QSEOW_PASSWORD_PATH)");
    // Must run before the username is echoed (errors, startup log).
    if (username === password || username.split("\\").includes(password)) {
      throw new Error("QSEOW_USERNAME contains the password. Put your login name there (DOMAIN\\user); the password belongs in QSEOW_PASSWORD or QSEOW_PASSWORD_PATH");
    }
    if (!/^[^\\]+\\[^\\]+$/.test(username)) throw new Error(`QSEOW_USERNAME must be DOMAIN\\user, got "${username}"`);
    windowsLogin = { username, password };
  }

  const groups = (env("QSEOW_TOOL_GROUPS", "analyst,developer,admin") ?? "")
    .split(",").map((g) => g.trim().toLowerCase()).filter(Boolean) as ToolGroup[];

  return {
    host: env("QSEOW_HOST", "localhost")!,
    qrsPort: Number(env("QSEOW_QRS_PORT", "4242")),
    enginePort: Number(env("QSEOW_ENGINE_PORT", "4747")),
    proxyPort: Number(env("QSEOW_PROXY_PORT", "443")),
    qpsPort: Number(env("QSEOW_QPS_PORT", "4243")),
    authMode,
    // JWT proxies are always prefixed; windows login usually uses the default proxy.
    vpPrefix: env("QSEOW_VP_PREFIX", authMode === "windows" ? "" : "jwt")!,
    jwt,
    windowsLogin,
    cert,
    ca,
    certUser: {
      directory: env("QSEOW_CERT_USER_DIRECTORY", "INTERNAL")!,
      id: env("QSEOW_CERT_USER_ID", "sa_repository")!,
    },
    tlsVerify: env("QSEOW_TLS_VERIFY", "true") !== "false",
    toolGroups: new Set(groups),
    allowMutations: env("QSEOW_ALLOW_MUTATIONS", "false") === "true",
  };
}
