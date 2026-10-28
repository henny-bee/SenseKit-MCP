export const READ = { readOnlyHint: true, openWorldHint: false };

// Selections change only engine session state, nothing persisted.
export const SESSION_MUT = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
