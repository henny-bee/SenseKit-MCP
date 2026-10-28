import { z } from "zod";

// ids go into QRS and WebSocket URLs: the GUID gate blocks path injection.
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const guid = z.string().regex(GUID_RE, "must be a GUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)");

export const pageParams = {
  offset: z.number().int().min(0).optional().describe("Skip this many items (default 0)"),
  limit: z.number().int().positive().max(1000).optional().describe("Max items to return (default 100, max 1000)"),
};
