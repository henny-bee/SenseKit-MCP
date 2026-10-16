/** Flatten the engine healthcheck payload into the numbers an operator asks
 *  for first; the raw payload rides along untouched. */
/** The engine /healthcheck payload. Every field is optional: older engine
 *  builds report counts where newer ones report arrays (see apps.*). */
export interface HealthcheckPayload {
  version?: unknown;
  started?: unknown;
  saturated?: unknown;
  mem?: { committed?: unknown; free?: unknown; [key: string]: unknown };
  cpu?: { total?: unknown; [key: string]: unknown };
  session?: unknown;
  apps?: { active_docs?: unknown; loaded_docs?: unknown; in_memory_docs?: unknown; calls?: unknown; selections?: unknown; [key: string]: unknown };
  users?: unknown;
  [key: string]: unknown;
}

export function summarizeHealthcheck(h: HealthcheckPayload) {
  const committed = Number(h.mem?.committed ?? 0);
  const free = Number(h.mem?.free ?? 0);
  return {
    version: h.version,
    started: h.started,
    saturated: h.saturated === true,
    memCommittedMB: committed,
    memFreeMB: free,
    cpuTotalPct: h.cpu?.total,
    sessions: h.session,
    apps: {
      activeDocs: Array.isArray(h.apps?.active_docs) ? h.apps?.active_docs.length : h.apps?.active_docs,
      loadedDocs: Array.isArray(h.apps?.loaded_docs) ? h.apps?.loaded_docs.length : h.apps?.loaded_docs,
      inMemoryDocs: Array.isArray(h.apps?.in_memory_docs) ? h.apps?.in_memory_docs.length : h.apps?.in_memory_docs,
      calls: h.apps?.calls,
      selections: h.apps?.selections,
    },
    users: h.users,
    raw: h,
  };
}
