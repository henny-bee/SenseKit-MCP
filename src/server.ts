import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools, type ToolDeps } from "./tools/index.js";
import { installErrorBoundary } from "./tools/error-boundary.js";

// Single source of truth for the version: package.json (dist/ sits one level
// below it both in the repo and in the npm tarball).
export const VERSION: string = createRequire(import.meta.url)("../package.json").version;

/** The MCP server identity reported in initialize and the startup log. */
export const SERVER_NAME = "sensekit-mcp";

export type ServerDeps = ToolDeps;

/** Build the MCP server with every enabled tool registered. Pure wiring: no
 *  transport, no I/O — clients come in through `deps`, so tests can pass fakes. */
export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });
  // Before any tool registers: every handler's throw becomes a structured
  // { code, message, details? } error result.
  installErrorBoundary(server);
  registerTools(server, deps);
  return server;
}
