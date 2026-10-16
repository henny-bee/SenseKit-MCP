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

/** Everything a tool handler may touch. Passed in, never constructed here,
 *  so the whole tool surface can be wired against fakes. */
export interface ToolDeps {
  cfg: Config;
  engine: EngineClient;
  qrs: QrsClient;
  session?: ProxySession;
}

/** Register every tool the config enables. Tool-GROUP gating lives here and
 *  nowhere else; mutation gating stays inside each module, next to the
 *  tools it hides. Registration order is the tools/list order. */
export function registerTools(server: McpServer, { cfg, engine, qrs, session }: ToolDeps): void {
  // Mutating tools are gated at REGISTRATION: with mutations disabled they
  // are never added to the server, so tools/list is honestly read-only.
  if (cfg.toolGroups.has("admin")) {
    registerAdminTools(server, qrs, cfg);
    // Ops layer (Tier 2): reload forensics, engine health, security-rule
    // audit, QPS sessions. Read-only except end_user_sessions (mutation-gated).
    registerOpsTools(server, qrs, cfg, session);
  }
  if (cfg.toolGroups.has("analyst")) {
    registerAnalystTools(server, engine);
    // The troubleshooting loop (sheets, objects, expression search, master
    // items, lineage) ships with the analyst group: read-only introspection.
    registerInspectorTools(server, engine);
  }
  if (cfg.toolGroups.has("developer")) {
    registerDeveloperTools(server, engine, qrs, cfg);
    // UI builder + render-validation gate. validate_sheet is read-only and
    // always registers with the group; create/add/update/move/delete are
    // mutation-gated inside.
    registerBuilderTools(server, engine, qrs, cfg);
    // Master-item governance (create/delete library measures + dimensions).
    // All mutating, so nothing registers unless mutations are enabled.
    registerMasterTools(server, engine, cfg);
  }
}
