import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import type { EngineClient } from "../clients/engine.js";
import type { QrsClient } from "../clients/qrs.js";
import type { ProxySession } from "../clients/proxy-session.js";
import { registerAdminTools } from "./admin.js";
import { registerAnalystTools } from "./analyst.js";
import { registerDeveloperTools } from "./developer.js";
import { registerInspectorTools } from "./inspector.js";
import { registerOpsTools } from "./ops.js";
import { registerBuilderTools } from "./builder.js";
import { registerMasterTools } from "./master.js";
import { registerRenderTools } from "./render.js";
import { playwrightInstalled } from "../clients/browser.js";
import { KeyedLock } from "../core/lock.js";

export interface ToolDeps {
  cfg: Config;
  engine: EngineClient;
  qrs: QrsClient;
  session?: ProxySession;
}

// Group gating lives here only; mutation gating stays in each module. Order = tools/list order.
export function registerTools(server: McpServer, { cfg, engine, qrs, session }: ToolDeps): void {
  // One lock shared by all writers: concurrent writes to one app run serially.
  const writes = new KeyedLock();
  if (cfg.toolGroups.has("admin")) {
    registerAdminTools(server, qrs, cfg);
    registerOpsTools(server, qrs, cfg, session);
  }
  if (cfg.toolGroups.has("analyst")) {
    registerAnalystTools(server, engine);
    registerInspectorTools(server, engine);
  }
  if (cfg.toolGroups.has("developer")) {
    registerDeveloperTools(server, engine, qrs, cfg, writes);
    registerBuilderTools(server, engine, qrs, cfg, writes);
    // Needs the proxy session cookie (not in certificate mode) and the optional browser driver.
    if (session && playwrightInstalled()) registerRenderTools(server, engine, cfg, session);
    registerMasterTools(server, engine, cfg, writes);
  }
}
