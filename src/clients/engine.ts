import { createRequire } from "node:module";
import WebSocket from "ws";
import { trustedCa, usesProxySession, vpPath, type Config } from "../config.js";
import type { ProxySession, ProxyCredentials } from "./proxy-session.js";
import type { Doc, Global, EnigmaSession } from "../qix/types.js";
import { ToolError } from "../core/errors.js";

const require = createRequire(import.meta.url);
// enigma.js ships no types; its handles are typed in qix/types.ts.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const enigma: { create(config: Record<string, unknown>): EnigmaSession } = require("enigma.js");
const schema: unknown = require("enigma.js/schemas/12.170.2.json");

// A 401/403 on the websocket upgrade is auth (cert, JWT, CSWSH), not engine.
function normalizeEngineError(prefix: string, e: unknown): ToolError {
  const message = e instanceof Error && e.message && e.message !== "[object Object]"
    ? `${prefix}: ${e.message}`
    : `${prefix}: ${JSON.stringify(e)}`;
  return new ToolError(/\b40[13]\b/.test(message) ? "AUTH_ERROR" : "ENGINE_ERROR", message);
}

interface CachedGlobal {
  session: EnigmaSession;
  global: Global;
  lastUsed: number;
}

interface CachedApp {
  session: EnigmaSession;
  doc: Doc;
  lastUsed: number;
}

// One socket per app: a QIX socket holds one doc (2nd OpenDoc: "App already open").
// Proxy modes share one session cookie so sockets don't hit the 5-session limit.
export class EngineClient {
  private globalCached?: CachedGlobal;
  private appCached = new Map<string, CachedApp>();
  private idleTimer?: ReturnType<typeof setInterval>;

  constructor(private cfg: Config, private session?: ProxySession) {
    this.idleTimer = setInterval(() => this.reapIdle(), 60_000);
    this.idleTimer.unref?.();
  }

  private wsUrl(pathId: string, creds?: ProxyCredentials): string {
    const cfg = this.cfg;
    if (creds) {
      // CSWSH check needs the CSRF token on the URL (older proxies issue none).
      const { csrfToken } = creds;
      const query = csrfToken ? `?qlik-csrf-token=${encodeURIComponent(csrfToken)}` : "";
      return `wss://${cfg.host}:${cfg.proxyPort}${vpPath(cfg)}/app/${pathId}${query}`;
    }
    return `wss://${cfg.host}:${cfg.enginePort}/app/${pathId}`;
  }

  private createSocket(url: string, creds?: ProxyCredentials): WebSocket {
    const cfg = this.cfg;
    const ca = trustedCa(cfg);
    if (creds) {
      // Cookie, not bearer: a bearer re-authenticates and fails the CSWSH check.
      return new WebSocket(url, {
        rejectUnauthorized: cfg.tlsVerify,
        ...(ca ? { ca: [ca] } : {}),
        origin: `https://${cfg.host}:${cfg.proxyPort}`,
        headers: { Cookie: creds.cookie },
      });
    }
    return new WebSocket(url, {
      rejectUnauthorized: cfg.tlsVerify,
      cert: cfg.cert!.cert,
      key: cfg.cert!.key,
      passphrase: cfg.cert!.passphrase,
      ca: ca ? [ca] : undefined,
      headers: {
        "X-Qlik-User": `UserDirectory=${cfg.certUser.directory}; UserId=${cfg.certUser.id}`,
      },
    });
  }

  // Creds go per socket so concurrent opens never mix cookie and CSRF token.
  private async openSession(pathId: string): Promise<{ session: EnigmaSession; global: Global }> {
    if (usesProxySession(this.cfg) && this.session) {
      return this.session.run((creds) => this.openWith(pathId, creds));
    }
    return this.openWith(pathId);
  }

  private async openWith(pathId: string, creds?: ProxyCredentials): Promise<{ session: EnigmaSession; global: Global }> {
    const session = enigma.create({
      schema,
      url: this.wsUrl(pathId, creds),
      createSocket: (url: string) => this.createSocket(url, creds),
      suspendOnClose: false,
    });
    let global: Global;
    try {
      global = await session.open();
    } catch (e) {
      try { await session.close(); } catch { /* noop */ }
      throw normalizeEngineError("engine session open failed", e);
    }
    return { session, global };
  }

  async global(): Promise<Global> {
    if (this.globalCached) {
      this.globalCached.lastUsed = Date.now();
      return this.globalCached.global;
    }
    const { session, global } = await this.openSession("engineData");
    session.on("closed", () => { this.globalCached = undefined; });
    this.globalCached = { session, global, lastUsed: Date.now() };
    return global;
  }

  // Doc is cached so selections persist across tool calls.
  async app(appId: string): Promise<Doc> {
    // appId goes into the WS URL path: GUIDs only (defense in depth).
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId)) {
      throw new ToolError("INVALID_INPUT", `appId must be a GUID, got: ${appId.slice(0, 60)}`);
    }
    const existing = this.appCached.get(appId);
    if (existing) {
      try {
        await existing.doc.getAppLayout(); // liveness check
        existing.lastUsed = Date.now();
        return existing.doc;
      } catch {
        this.appCached.delete(appId);
        try { await existing.session.close(); } catch { /* already gone */ }
      }
    }
    const { session, global } = await this.openSession(appId);
    session.on("closed", () => { this.appCached.delete(appId); });
    try {
      const doc = await global.openDoc(appId, "", "", "", false);
      this.appCached.set(appId, { session, doc, lastUsed: Date.now() });
      return doc;
    } catch (e) {
      try { await session.close(); } catch { /* noop */ }
      throw normalizeEngineError(`openDoc(${appId}) failed`, e);
    }
  }

  private async reapIdle(): Promise<void> {
    const cutoff = Date.now() - 5 * 60_000;
    if (this.globalCached && this.globalCached.lastUsed < cutoff) {
      try { await this.globalCached.session.close(); } catch { /* already gone */ }
      this.globalCached = undefined;
    }
    for (const [appId, entry] of this.appCached) {
      if (entry.lastUsed < cutoff) {
        this.appCached.delete(appId);
        try { await entry.session.close(); } catch { /* already gone */ }
      }
    }
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.globalCached) { try { await this.globalCached.session.close(); } catch { /* noop */ } }
    this.globalCached = undefined;
    for (const [, entry] of this.appCached) {
      try { await entry.session.close(); } catch { /* noop */ }
    }
    this.appCached.clear();
  }
}
