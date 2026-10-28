import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { renderSheet } from "../clients/browser.js";
import type { EngineClient } from "../clients/engine.js";
import type { ProxySession } from "../clients/proxy-session.js";
import type { Config } from "../config.js";
import { READ } from "../core/annotations.js";
import { guid } from "../core/schemas.js";
import { requireChildOf } from "../qix/objects.js";

export function registerRenderTools(server: McpServer, engine: EngineClient, cfg: Config, session: ProxySession): void {
  server.registerTool(
    "render_sheet",
    {
      description:
        "See a sheet the way a user sees it: opens it in a headless browser (1600x900, 16:9) with the server's own proxy session " +
        "and returns a screenshot plus each object's status — renders, blank (finished but drew nothing), error (with the client's " +
        "message), not-rendered (still loading after 20 s) or missing. The statuses are hints; the screenshot is the evidence. Shows this session's current selections " +
        "(clear_selections first for an unfiltered view). Pass objectId for a close-up of one object.",
      inputSchema: {
        appId: guid.describe("App id (GUID)"),
        sheetId: z.string().describe("Sheet id (from list_sheets)"),
        objectId: z.string().optional().describe("Screenshot only this object (must be on the sheet)"),
      },
      annotations: { ...READ, idempotentHint: true },
    },
    async ({ appId, sheetId, objectId }) => {
      const sheet = await (await engine.app(appId)).getObject(sheetId);
      if (objectId) await requireChildOf(sheet, sheetId, objectId);
      const children = (await sheet.getChildInfos()).map((c) => ({ id: c.qId, type: c.qType }));
      const r = await session.run((creds) => renderSheet(cfg, creds.cookie, appId, sheetId, children, objectId));
      return {
        content: [
          { type: "image" as const, data: r.image, mimeType: "image/png" },
          { type: "text" as const, text: JSON.stringify({ sheetId, ...(objectId ? { objectId } : {}), viewport: "1600x900", objects: r.objects }, null, 2) },
        ],
      };
    },
  );
}
