// The one error boundary: install before any tool registers; no per-tool try/catch.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toErrorPayload } from "../core/errors.js";
import { redactSecrets } from "../core/redact.js";

// Redacted: QRS error bodies can echo connection strings.
export function errorResult(e: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(redactSecrets(toErrorPayload(e)), null, 2) }],
  };
}

type AnyHandler = (...args: unknown[]) => unknown;

// Only wraps tools registered after this call.
export function installErrorBoundary(server: McpServer): void {
  const register = server.registerTool.bind(server) as unknown as (name: string, config: unknown, handler: AnyHandler) => unknown;
  const guarded = (name: string, config: unknown, handler: AnyHandler) =>
    register(name, config, async (...args: unknown[]) => {
      try {
        return await handler(...args);
      } catch (e) {
        return errorResult(e);
      }
    });
  server.registerTool = guarded as unknown as typeof server.registerTool;
}
