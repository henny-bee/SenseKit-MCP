import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EngineClient } from "../clients/engine.js";
import type { QrsClient } from "../clients/qrs.js";
import type { QrsApp, QrsEntity } from "../clients/qrs-types.js";
import type { Config } from "../config.js";
import { text } from "../core/result.js";
import { READ } from "../core/annotations.js";
import { guid } from "../core/schemas.js";
import { scrubString, REDACTED } from "../core/redact.js";
import { qrsQuote } from "../core/qrs-filter.js";
import { ToolError } from "../core/errors.js";
import type { KeyedLock } from "../core/lock.js";
import { saveApp } from "../qix/save.js";

export function registerDeveloperTools(server: McpServer, engine: EngineClient, qrs: QrsClient, cfg: Config, writes: KeyedLock): void {
  server.registerTool(
    "get_script",
    {
      description: "Get an app's load script. Embedded credentials (inline connection strings, secret-bearing variables) are redacted — scripts with masked values cannot be round-tripped through set_script.",
      inputSchema: { appId: guid.describe("App id (GUID)") },
      annotations: READ,
    },
    async ({ appId }) => {
      const app = await engine.app(appId);
      // Scripts leak credentials too (CUSTOM CONNECT, LET vPassword = ...).
      const raw: string = await app.getScript();
      const clean = scrubString(raw);
      return text(clean === raw ? clean : `// NOTE: credential-bearing values were redacted from this script.\n${clean}`);
    },
  );

  server.registerTool(
    "check_script",
    {
      description: "Syntax-check an app's current load script. Returns [] when clean.",
      inputSchema: { appId: guid.describe("App id (GUID)") },
      annotations: READ,
    },
    async ({ appId }) => {
      const app = await engine.app(appId);
      const errs = await app.checkScriptSyntax();
      return text(errs.length === 0 ? "No syntax errors." : errs);
    },
  );

  if (!cfg.allowMutations) return;

  server.registerTool(
    "set_script",
    {
      description: "Replace an app's load script and save. MUTATION: overwrites the existing script.",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        script: z.string().describe("Complete load script"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    writes.byApp(async ({ appId, script }) => {
      // A redacted round trip would overwrite real credentials with the mask.
      if (script.includes(REDACTED)) {
        throw new ToolError(
          "VALIDATION_REFUSED",
          `Refusing to write a script containing the redaction marker ${REDACTED}. ` +
          "Restore the original credential-bearing lines (or move the credentials into a data connection) and retry.",
        );
      }
      const app = await engine.app(appId);
      await app.setScript(script);
      await saveApp(app);
      return text(`Script updated and saved for ${appId} (${script.length} chars).`);
    }),
  );

  server.registerTool(
    "reload_app",
    {
      description: "Reload an app in the engine session and save. Returns success flag and the tail of the reload progress log. MUTATION: replaces the app's data.",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        partial: z.boolean().optional().describe("Partial reload (default false)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    writes.byApp(async ({ appId, partial }) => {
      const g = await engine.global();
      const app = await engine.app(appId);
      const ok = await app.doReload(0, partial ?? false, false);
      let progress = "";
      try {
        const p = await g.getProgress(0);
        progress = (p.qPersistentProgressMessages ?? []).map((m) => m.qMessageParameters?.join(" ") ?? "").join("\n");
      } catch { /* progress unavailable */ }
      if (ok) await saveApp(app);
      return text({ appId, reloadSuccess: ok, saved: ok, progressTail: scrubString(progress.slice(-2000)) });
    }),
  );

  server.registerTool(
    "create_app",
    {
      description: "Create a new app, optionally set its script and reload it. Returns the new app id. MUTATION (additive).",
      inputSchema: {
        name: z.string().describe("App name"),
        script: z.string().optional().describe("Load script to set"),
        reload: z.boolean().optional().describe("Reload after setting script (default false)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name, script, reload }) => {
      const g = await engine.global();
      const created = await g.createApp(name, "main");
      if (!created.qSuccess) throw new ToolError("ENGINE_ERROR", "Engine refused to create app");
      const appId = created.qAppId;
      let reloaded: boolean | undefined;
      if (script) {
        const app = await engine.app(appId);
        await app.setScript(script);
        if (reload) reloaded = await app.doReload(0, false, false);
        await saveApp(app);
      }
      return text({ appId, name, scriptSet: Boolean(script), reloaded });
    },
  );

  server.registerTool(
    "copy_app",
    {
      description: "Copy an app in the repository under a new name. MUTATION (additive).",
      inputSchema: {
        appId: guid.describe("Source app id (GUID)"),
        name: z.string().describe("Name for the copy"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ appId, name }) => {
      const copy = await qrs.post<QrsApp>(`/qrs/app/${appId}/copy?name=${encodeURIComponent(name)}`);
      return text({ newAppId: copy.id, name: copy.name });
    },
  );

  server.registerTool(
    "delete_app",
    {
      description: "Delete an app from the repository by id. MUTATION: irreversible — the app and its data are removed.",
      inputSchema: { appId: guid.describe("App id (GUID)") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ appId }) => {
      await qrs.delete(`/qrs/app/${appId}`);
      return text(`App ${appId} deleted.`);
    },
  );

  server.registerTool(
    "publish_app",
    {
      description: "Publish an app to a stream by stream name. MUTATION: changes app visibility site-wide.",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        streamName: z.string().describe("Target stream name"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ appId, streamName }) => {
      const streams = await qrs.get<QrsEntity[]>(`/qrs/stream/full?filter=${encodeURIComponent(`name eq '${qrsQuote(streamName)}'`)}`);
      if (streams.length === 0) throw new ToolError("NOT_FOUND", `Stream not found: ${streamName}`, { streamName });
      const pub = await qrs.put<QrsApp>(`/qrs/app/${appId}/publish?stream=${streams[0].id}`);
      return text({ appId: pub.id, name: pub.name, stream: pub.stream?.name, published: pub.published });
    },
  );
}
