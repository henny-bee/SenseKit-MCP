// The single error boundary for every tool. Installed once on the server
// (createServer) before any tool registers: each handler is wrapped so a
// throw becomes an MCP tool result with `isError: true` and JSON text
// `{ code, message, details? }` — never a per-tool try/catch. Input-schema
// violations are rejected by the MCP SDK before a handler runs and keep the
// SDK's own error text.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toErrorPayload } from "../core/errors.js";
import { redactSecrets } from "../core/redact.js";

/** The tool result for a thrown error. Error text is an egress path too (QRS
 *  error bodies can echo connection strings), so it is redacted like any
 *  other output. */
export function errorResult(e: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(redactSecrets(toErrorPayload(e)), null, 2) }],
  };
}

type AnyHandler = (...args: unknown[]) => unknown;

/** Wrap every tool registered on `server` from now on. registerTool's
 *  overloads cannot be expressed generically, so the patch is typed at the
 *  boundary: callers keep the SDK's full types. */
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
