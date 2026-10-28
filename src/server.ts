import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools, type ToolDeps } from "./tools/index.js";
import { installErrorBoundary } from "./tools/error-boundary.js";

// dist/ sits one level below package.json in both the repo and the npm tarball.
export const VERSION: string = createRequire(import.meta.url)("../package.json").version;

export const SERVER_NAME = "sensekit-mcp";

export type ServerDeps = ToolDeps;

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });
  // Must run before any tool registers.
  installErrorBoundary(server);
  registerTools(server, deps);
  return server;
}
