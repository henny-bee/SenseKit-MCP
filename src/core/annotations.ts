// MCP tool annotations shared by every tool module. The Qlik site is a
// closed domain — no tool reaches beyond it (openWorldHint: false).
export const READ = { readOnlyHint: true, openWorldHint: false };

// Selections mutate only engine session state — no persisted data changes —
// so selection tools carry readOnlyHint: false but destructiveHint: false.
export const SESSION_MUT = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
