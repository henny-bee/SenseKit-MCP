import { z } from "zod";

// ── Input validation ─────────────────────────────────────────────────────────
// Repository/engine ids are GUIDs. Tool args are supplied by an LLM that may
// hold untrusted content in context, and ids are interpolated into QRS URL
// paths and WebSocket URLs — a GUID gate closes that path-injection surface.

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const guid = z.string().regex(GUID_RE, "must be a GUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)");

// Paging inputs every list tool takes (see paging.ts for the envelope).
export const pageParams = {
  offset: z.number().int().min(0).optional().describe("Skip this many items (default 0)"),
  limit: z.number().int().positive().max(1000).optional().describe("Max items to return (default 100, max 1000)"),
};
