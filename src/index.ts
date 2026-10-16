#!/usr/bin/env node
// CLI entry: load config, build the clients and the server, serve stdio.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, usesProxySession } from "./config.js";
import { QrsClient } from "./clients/qrs.js";
import { ProxySession } from "./clients/proxy-session.js";
import { EngineClient } from "./clients/engine.js";
import { createServer, SERVER_NAME, VERSION } from "./server.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const session = usesProxySession(cfg) ? new ProxySession(cfg) : undefined;
  const qrs = new QrsClient(cfg, session);
  const engine = new EngineClient(cfg, session);
  const server = createServer({ cfg, engine, qrs, session });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `${SERVER_NAME} ${VERSION} | host=${cfg.host} auth=${cfg.authMode}` +
    (cfg.windowsLogin ? ` user=${cfg.windowsLogin.username}` : "") +
    ` groups=[${[...cfg.toolGroups].join(",")}] mutations=${cfg.allowMutations ? "ENABLED" : "read-only (mutating tools not registered)"}`,
  );

  const shutdown = async () => { await engine.close(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
