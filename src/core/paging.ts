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
