// ── Pagination ───────────────────────────────────────────────────────────────
// QRS "full" endpoints return every entity on the site (thousands on a real
// enterprise deployment) and the engine doc list can be similarly large.
// Every list tool takes offset/limit and returns a stable envelope so an MCP
// client can page instead of blowing its context window.

export function paginate<T>(items: T[], offset?: number, limit?: number, defaultLimit = 100) {
  const off = offset ?? 0;
  const lim = limit ?? defaultLimit;
  const page = items.slice(off, off + lim);
  return {
    total: items.length,
    offset: off,
    returned: page.length,
    truncated: off + page.length < items.length,
    items: page,
  };
}
